// "Find me something."
//
// Everything about what you read stays on this device. What leaves is a
// compressed summary — a handful of loved titles, the moods you reach for most,
// and a list of things not to suggest. Not the shelf.
//
// The backend is a Cloudflare Worker holding the Anthropic key; see api/README.md.
// Its URL is deployment config, not a credential — the endpoint is useless
// without a Firebase token signed for this project.
import { idToken } from '../state/auth.js'
import { searchBooks } from './books.js'
import { bookKey } from './book-shape.js'

export const API_URL = 'https://otherworld-reads-api.laurenmtech-aef.workers.dev/recommend'

const TIMEOUT_MS = 45000

// How much of the shelf gets compressed into the summary. Small on purpose:
// the acceptance criterion is that a short summary works well enough in
// practice before anyone considers sending the whole finished list.
const RECENT_LOVED = 8
const TOP_MOODS = 6

// ── What the model is told about you ────────────────────────────────────────

// Loved books first, then merely liked, newest first. A book you loved says
// far more about what to offer next than one you finished and shrugged at.
export function tasteSummary(state){
  const finished = (state.finished || []).filter(b => !b.setDown)
  const rank = { loved: 0, liked: 1 }
  const scored = finished
    .map((b, i) => ({ b, i, r: rank[b.feeling] ?? 2 }))
    .filter(x => x.r < 2)
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .slice(0, RECENT_LOVED)

  const lines = scored.map(({ b, r }) => {
    const bits = [b.author && `by ${b.author}`, (b.genres || []).join('/'), (b.moods || []).join(', ')]
      .filter(Boolean).join(' · ')
    return `- ${r === 0 ? 'Loved' : 'Liked'}: ${b.title}${bits ? ` (${bits})` : ''}`
  })

  // The vocabulary someone actually reaches for, counted rather than guessed.
  const tally = new Map()
  for(const b of finished) for(const m of b.moods || []) tally.set(m, (tally.get(m) || 0) + 1)
  const moods = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MOODS).map(e => e[0])
  if(moods.length) lines.push(`- Words they reach for: ${moods.join(', ')}`)

  return lines.join('\n')
}

// ── What not to offer ───────────────────────────────────────────────────────

// A series you bounced off is a series, not a book. If the earliest entry you
// read from it was set down as "not for me", book two is not a fresh start —
// so the whole series is excluded. Uses the seriesKey captured in Phase 4;
// where a book has no series data the rule simply doesn't apply, which is most
// books and is fine.
export function abandonedSeries(state){
  const out = new Set()
  const bySeries = new Map()
  for(const b of state.finished || []){
    if(!b.seriesKey) continue
    if(!bySeries.has(b.seriesKey)) bySeries.set(b.seriesKey, [])
    bySeries.get(b.seriesKey).push(b)
  }
  for(const [key, books] of bySeries){
    // Earliest by series position where known, else by how long it's been in
    // the record — "the first one they read", as closely as we can tell.
    const sorted = [...books].sort((a, b) =>
      ((a.seriesPosition ?? 1e9) - (b.seriesPosition ?? 1e9)) ||
      (Date.parse(a.finishedAt || 0) - Date.parse(b.finishedAt || 0)))
    const first = sorted[0]
    if(first && (first.setDown || first.feeling === 'not-for-me')) out.add(key)
  }
  return out
}

// Everything they own, have read, set down, or already said no to — as plain
// "Title — Author" lines, which is all the model needs to avoid them.
export function exclusions(state){
  const lists = [state.currentReads, state.wishlist, state.finished, state.passed]
  const seen = new Set()
  const out = []
  for(const list of lists){
    for(const b of list || []){
      if(!b || !b.title) continue
      const k = bookKey(b)
      if(seen.has(k)) continue
      seen.add(k)
      out.push(b.author ? `${b.title} — ${b.author}` : b.title)
    }
  }
  return out
}

// ── Asking ──────────────────────────────────────────────────────────────────

export class RecommendError extends Error {
  constructor(type, message){ super(message); this.type = type }
}

const MESSAGES = {
  signed_out: 'Sign in to ask for a recommendation.',
  offline: 'You’re offline — this one needs a connection.',
  unauthenticated: 'Sign in to ask for a recommendation.',
  over_quota: 'That’s all for today. More tomorrow.',
  upstream_failure: 'Couldn’t reach the recommender just now.',
  network: 'Couldn’t reach the recommender just now.',
  none_found: 'Nothing came back that I could verify. Try again, or say more about what you want.'
}

export const messageFor = (type) => MESSAGES[type] || MESSAGES.upstream_failure

// Returns { suggestions, remaining }. Throws RecommendError with a type the
// sheet can render as one plain sentence.
export async function askForBooks({ moods = [], freeText = '' } = {}, state){
  if(navigator.onLine === false) throw new RecommendError('offline', MESSAGES.offline)
  const token = await idToken()
  if(!token) throw new RecommendError('signed_out', MESSAGES.signed_out)

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  let res
  try{
    res = await fetch(API_URL, {
      method: 'POST',
      signal: timer.signal,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        moods,
        freeText,
        tasteSummary: tasteSummary(state),
        exclude: exclusions(state)
      })
    })
  }catch(err){
    throw new RecommendError('network', MESSAGES.network)
  }finally{
    clearTimeout(stop)
  }

  let data = null
  try{ data = await res.json() }catch(e){ /* handled below */ }

  if(!res.ok){
    const type = (data && data.error && data.error.type) || 'upstream_failure'
    // The Worker's message is written for a reader, so show it rather than
    // second-guessing it — it knows the actual daily cap, for one thing.
    throw new RecommendError(type, (data && data.error && data.error.message) || messageFor(type))
  }

  const raw = Array.isArray(data && data.suggestions) ? data.suggestions : []
  const abandoned = abandonedSeries(state)
  const verified = await verify(raw, state, abandoned)
  if(!verified.length) throw new RecommendError('none_found', MESSAGES.none_found)
  return { suggestions: verified, remaining: data.remaining }
}

// ── Verification: the anti-invention pass ───────────────────────────────────

// Punctuation and case removed, and "&" spelled out — Open Library files
// Susanna Clarke's second novel as "Jonathan Strange & Mr. Norrell" while the
// model writes "Mr Norrell". An exact-match check drops that as an invention,
// which is the anti-hallucination guard failing in the direction nobody notices.
function norm(s){
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function sameTitle(a, b){
  const x = norm(a), y = norm(b)
  if(!x || !y) return false
  return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ')
}

// A suggestion survives only if a real book with that title comes back from the
// search. Anything unresolvable is dropped silently — a short list of real
// books beats five with one invention, and explaining the drop would only
// advertise that the model sometimes makes things up.
export async function verify(suggestions, state, abandoned = new Set()){
  const have = new Set()
  for(const list of [state.currentReads, state.wishlist, state.finished, state.passed]){
    for(const b of list || []) have.add(bookKey(b))
  }

  const checked = await Promise.all(suggestions.map(async (s) => {
    if(!s || !s.title) return null
    let results = []
    try{ results = await searchBooks(`${s.title} ${s.author || ''}`.trim()) }
    catch(e){ return null }
    const match = results.find(b => sameTitle(b.title, s.title))
    if(!match) return null

    // Belt and braces: the model was told not to suggest these, but a title it
    // phrased differently could still slip past the exclusion list it was given.
    if(have.has(bookKey(match))) return null
    if(match.seriesKey && abandoned.has(match.seriesKey)) return null

    // The real record wins on everything except the reason, which is the one
    // thing only the model knows.
    return { ...match, why: s.why || '' }
  }))

  const out = []
  const seen = new Set()
  for(const b of checked){
    if(!b) continue
    const k = bookKey(b)
    if(seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out
}
