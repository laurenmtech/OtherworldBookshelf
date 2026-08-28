// The entire backend: two routes, one file's worth of decisions.
//
//   POST /recommend
//   Authorization: Bearer <Firebase ID token>
//   { moods[], freeText, tasteSummary, exclude[] }
//     → { suggestions: [{title, author, why}], remaining }
//
//   POST /series
//   Authorization: Bearer <Firebase ID token>
//   { title, author }
//     → { series: null }
//     → { series: { key, name, position?, total?, next? } }
//
// The Anthropic key lives in a Worker secret and never reaches a browser. The
// user id comes from the verified token and never from the request body. And
// nothing about what anyone reads is logged — see logging note at the bottom.
import { verifyIdToken } from './firebase.js'
import { claim, refund, readUsed, DAILY_CAP, SERIES_DAILY_CAP } from './quota.js'
import { recommend, MODEL } from './recommend.js'
import { lookupSeries } from './series.js'
import { costMicros, addSpent, overBudget } from './budget.js'

// Typed so the UI can show them verbatim rather than inventing its own copy for
// each failure. The status codes matter as much as the strings: 429 is what a
// client should back off from, 502 is what it should offer to retry.
const ERRORS = {
  bad_request:      { status: 400, message: 'That request didn’t look right.' },
  unauthenticated:  { status: 401, message: 'Sign in to ask for a recommendation.' },
  over_quota:       { status: 429, message: 'That’s all for today. More tomorrow.' },
  // 503 rather than 429: this is not "you asked too often", it is "this one
  // feature is off until the month turns", and a client shouldn't back off and
  // retry into it.
  budget_exhausted: { status: 503, message: 'The recommender is resting until the 1st.' },
  upstream_failure: { status: 502, message: 'Couldn’t reach the recommender just now.' },
  bad_key:          { status: 400, message: 'That key wasn’t accepted. Check it, or remove it to use the shared one.' },
  not_found:        { status: 404, message: 'No such endpoint.' }
}

// Built from the cap actually in force, not the default — a message that says
// "all 10 for today" to someone whose cap is 3 is a message that lies.
const overQuotaMessage = (cap) => `That’s all ${cap} for today. More tomorrow.`

function corsHeaders(origin, allowed){
  // Echo the origin only when it's one we allow — a wildcard here would let any
  // site spend a signed-in reader's daily quota from their browser.
  const ok = allowed.includes(origin)
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-reader-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  }
}

function json(body, status, cors){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors }
  })
}

const fail = (type, cors) =>
  json({ error: { type, message: ERRORS[type].message } }, ERRORS[type].status, cors)

function allowedOrigins(env){
  return String(env.ALLOWED_ORIGINS || 'https://laurenmtech.github.io')
    .split(',').map(s => s.trim()).filter(Boolean)
}

// ── POST /recommend ─────────────────────────────────────────────────────────

// A reader's own key, if they brought one.
//
// In a HEADER and never the body, so it cannot end up in a URL, a referrer, or
// anything that gets written down. It is read, passed to the SDK, and dropped
// when the request ends: never stored in KV, never put in the response, and —
// like everything else here — never logged, because nothing here logs.
//
// The shape check is the same one the client makes. Rejecting a malformed key
// LOUDLY matters: silently falling back to the shared key would mean a reader
// who thinks they're paying for their own asks is quietly spending the app's
// budget instead.
const READER_KEY_HEADER = 'X-Reader-Key'
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,}$/

const readerKey = (request) => {
  const raw = (request.headers.get(READER_KEY_HEADER) || '').trim()
  return raw ? { present: true, key: raw, ok: KEY_SHAPE.test(raw) } : { present: false }
}

export async function handleRecommend(env, uid, body, cors, own = { present: false }){
  // Whatever the body claims about identity is ignored — `uid` is the only one
  // that exists as far as this Worker is concerned.
  const ask = {
    moods: Array.isArray(body.moods) ? body.moods.slice(0, 20).map(String) : [],
    freeText: typeof body.freeText === 'string' ? body.freeText.slice(0, 500) : '',
    tasteSummary: typeof body.tasteSummary === 'string' ? body.tasteSummary.slice(0, 4000) : '',
    exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 300).map(String) : []
  }

  // ---- whose key, and therefore whose meters? ----
  //
  // A reader on their own key bypasses BOTH shared meters — the month's budget
  // and the daily cap — because neither is about them: the budget is this
  // app's bill, and the daily cap is how that bill is kept down. Someone
  // spending their own money is subject to neither, which is the whole point of
  // letting them bring a key.
  if(own.present && !own.ok) return fail('bad_key', cors)
  if(own.present) return askOnOwnKey(env, own.key, ask, cors)

  // ---- is the month spent? ----
  // Checked BEFORE the daily credit is claimed, deliberately: a reader who is
  // turned away by the budget has not had an ask, and should not be charged one
  // out of their ten. A KV failure here is NOT fatal — an unreadable ledger
  // falls through to the ask, because the account-level spend limit is the
  // backstop and a broken counter shouldn't take the feature down.
  try{
    if(await overBudget(env.QUOTA, env)) return json(
      { error: { type: 'budget_exhausted', message: ERRORS.budget_exhausted.message } },
      ERRORS.budget_exhausted.status, cors
    )
  }catch(e){ /* fall through and ask */ }

  // ---- how many left ----
  const cap = Number(env.DAILY_CAP) > 0 ? Number(env.DAILY_CAP) : DAILY_CAP
  let claimed
  try{
    claimed = await claim(env.QUOTA, uid, cap)
  }catch(e){
    return fail('upstream_failure', cors)
  }
  if(!claimed.ok) return json(
    { error: { type: 'over_quota', message: overQuotaMessage(cap) }, remaining: 0 },
    ERRORS.over_quota.status, cors
  )

  // ---- ask ----
  try{
    const model = String(env.MODEL || MODEL)
    const { suggestions, usage } = await recommend(env.ANTHROPIC_API_KEY, ask, model)
    await addSpent(env.QUOTA, costMicros(model, usage))
    return json({ suggestions, remaining: claimed.remaining }, 200, cors)
  }catch(e){
    // The credit goes back: an outage on our side shouldn't spend someone's
    // allowance. Best-effort by nature — see quota.js.
    await refund(env.QUOTA, uid, cap)
    return fail('upstream_failure', cors)
  }
}

// No claim, no refund, no ledger entry: nothing about this ask touches a
// counter, because none of the counters are counting it. `remaining` comes back
// null rather than a number — there is no allowance left to report, and a
// number here would be a lie about a limit that isn't applying.
async function askOnOwnKey(env, key, ask, cors){
  try{
    const model = String(env.MODEL || MODEL)
    const { suggestions } = await recommend(key, ask, model)
    return json({ suggestions, remaining: null, ownKey: true }, 200, cors)
  }catch(e){
    // 401/403 from Anthropic means the key itself is the problem — a real key
    // in shape that the account won't honour, revoked, or out of credit. Saying
    // "couldn't reach the recommender" there would send someone debugging their
    // connection over a key they can fix in ten seconds.
    const status = e && (e.status || e.statusCode)
    if(status === 401 || status === 403) return fail('bad_key', cors)
    return fail('upstream_failure', cors)
  }
}

// ── POST /series ────────────────────────────────────────────────────────────

// Metered differently from /recommend, on purpose.
//
// A recommendation is asked for; a series lookup happens because someone added
// a book. So the counter here is an abuse ceiling rather than an allowance: it
// is never surfaced, it has its own generous cap, and — because a cache hit
// costs nothing to serve — it is only charged when we actually had to ask the
// model. That is what makes "the second reader to add this book costs nothing"
// true rather than merely cheap.
//
// The cap is checked BEFORE the ask and incremented AFTER it, which is a wider
// race than /recommend's claim-first. That is the right trade here: the failure
// mode is someone slightly exceeding an unstated ceiling, and the alternative
// charges every cache hit.
async function handleSeries(env, uid, body, cors){
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  const author = typeof body.author === 'string' ? body.author.trim().slice(0, 200) : ''
  if(!title) return fail('bad_request', cors)

  const cap = Number(env.SERIES_DAILY_CAP) > 0 ? Number(env.SERIES_DAILY_CAP) : SERIES_DAILY_CAP
  try{
    if(await readUsed(env.QUOTA, uid, 's') >= cap){
      return json({ error: { type: 'over_quota', message: ERRORS.over_quota.message } },
        ERRORS.over_quota.status, cors)
    }
  }catch(e){
    return fail('upstream_failure', cors)
  }

  try{
    const { series, cached, usage, model } = await lookupSeries(env, { title, author })
    if(!cached){
      await claim(env.QUOTA, uid, cap, 's')
      // Series spend is RECORDED but never gated. The ledger claims to be the
      // month's AI spend, so leaving out the Haiku calls would make it a lie —
      // but the budget ceiling stops the recommender only. A reader adding a
      // book is not asking for anything, and the app must not start failing at
      // it because a recommendation budget ran out.
      await addSpent(env.QUOTA, costMicros(model, usage))
    }
    return json({ series: series || null }, 200, cors)
  }catch(e){
    return fail('upstream_failure', cors)
  }
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const ROUTES = {
  '/recommend': handleRecommend,
  '/series': handleSeries
}

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(origin, allowedOrigins(env))

    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const { pathname } = new URL(request.url)
    const handler = ROUTES[pathname]
    if(!handler) return fail('not_found', cors)
    if(request.method !== 'POST') return fail('bad_request', cors)

    // ---- who ----
    const auth = request.headers.get('Authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    let uid
    try{
      uid = await verifyIdToken(token, env.FIREBASE_PROJECT_ID)
    }catch(e){
      // Deliberately uniform: a caller who can't authenticate doesn't get told
      // which check failed.
      return fail('unauthenticated', cors)
    }

    // ---- what ----
    let body
    try{
      body = await request.json()
    }catch(e){
      return fail('bad_request', cors)
    }
    if(!body || typeof body !== 'object') return fail('bad_request', cors)

    // Only /recommend takes a reader's key. A series lookup is Haiku and costs
    // a tenth of a cent, and the fewer places a credential is accepted, the
    // fewer places it can go wrong.
    if(pathname === '/recommend') return handleRecommend(env, uid, body, cors, readerKey(request))
    return handler(env, uid, body, cors)
  }
}

// A note on logging, since the absence of something is hard to notice in review:
// there are no console.log calls in this Worker, and that is deliberate. No
// prompt, no mood, no book title, no suggestion, and no reader's words are ever
// written anywhere. The only thing this backend stores about a person is an
// integer per day, which expires in 48 hours.
//
// The month's spend ledger added in Phase 10 keeps that promise: it is one
// running total for the whole Worker, with no uid in the key and no per-ask
// row, so it says what the month cost and nothing whatever about who asked.
