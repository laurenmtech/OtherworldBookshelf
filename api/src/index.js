// The entire backend: one route, one file's worth of decisions.
//
//   POST /recommend
//   Authorization: Bearer <Firebase ID token>
//   { moods[], freeText, tasteSummary, exclude[] }
//     → { suggestions: [{title, author, why}], remaining }
//
// The Anthropic key lives in a Worker secret and never reaches a browser. The
// user id comes from the verified token and never from the request body. And
// nothing about what anyone reads is logged — see logging note at the bottom.
import { verifyIdToken } from './firebase.js'
import { claim, refund, DAILY_CAP } from './quota.js'
import { recommend } from './recommend.js'

// Typed so the UI can show them verbatim rather than inventing its own copy for
// each failure. The status codes matter as much as the strings: 429 is what a
// client should back off from, 502 is what it should offer to retry.
const ERRORS = {
  bad_request:      { status: 400, message: 'That request didn’t look right.' },
  unauthenticated:  { status: 401, message: 'Sign in to ask for a recommendation.' },
  over_quota:       { status: 429, message: 'That’s all for today. More tomorrow.' },
  upstream_failure: { status: 502, message: 'Couldn’t reach the recommender just now.' },
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
    'Access-Control-Allow-Headers': 'authorization, content-type',
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

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(origin, allowedOrigins(env))

    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const { pathname } = new URL(request.url)
    if(pathname !== '/recommend') return fail('not_found', cors)
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

    // Whatever the body claims about identity is ignored — `uid` above is the
    // only one that exists as far as this Worker is concerned.
    const ask = {
      moods: Array.isArray(body.moods) ? body.moods.slice(0, 20).map(String) : [],
      freeText: typeof body.freeText === 'string' ? body.freeText.slice(0, 500) : '',
      tasteSummary: typeof body.tasteSummary === 'string' ? body.tasteSummary.slice(0, 4000) : '',
      exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 300).map(String) : []
    }

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
      const { suggestions } = await recommend(env.ANTHROPIC_API_KEY, ask)
      return json({ suggestions, remaining: claimed.remaining }, 200, cors)
    }catch(e){
      // The credit goes back: an outage on our side shouldn't spend someone's
      // allowance. Best-effort by nature — see quota.js.
      await refund(env.QUOTA, uid, cap)
      return fail('upstream_failure', cors)
    }
  }
}

// A note on logging, since the absence of something is hard to notice in review:
// there are no console.log calls in this Worker, and that is deliberate. No
// prompt, no mood, no book title, no suggestion, and no reader's words are ever
// written anywhere. The only thing this backend stores about a person is an
// integer per day, which expires in 48 hours.
