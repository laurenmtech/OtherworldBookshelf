// "Find me something." What leaves this device is a compressed summary of your
// taste and a list of things not to suggest — never the shelf.
//
// EFFORT IS PINNED in the Worker: Opus 5 thinks by default and thinking bills as
// output. verify() below is the anti-invention pass — structured output removes
// the parsing failure, not the making-things-up one.
import { idToken } from '../state/auth.js'
import { readOwnKey } from './own-key.js'
import { searchBooks } from './books.js'
import { bookKey, sameTitle } from './book-shape.js'

export const API_BASE = 'https://otherworld-reads-api.laurenmtech-aef.workers.dev'
export const API_URL = `${API_BASE}/recommend`

const TIMEOUT_MS = 45000

const RECENT_LOVED = 8
const TOP_MOODS = 6

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

  const tally = new Map()
  for(const b of finished) for(const m of b.moods || []) tally.set(m, (tally.get(m) || 0) + 1)
  const moods = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MOODS).map(e => e[0])
  if(moods.length) lines.push(`- Words they reach for: ${moods.join(', ')}`)

  return lines.join('\n')
}

export function abandonedSeries(state){
  const out = new Set()
  const bySeries = new Map()
  for(const b of state.finished || []){
    if(!b.seriesKey) continue
    if(!bySeries.has(b.seriesKey)) bySeries.set(b.seriesKey, [])
    bySeries.get(b.seriesKey).push(b)
  }
  for(const [key, books] of bySeries){
    const sorted = [...books].sort((a, b) =>
      ((a.seriesPosition ?? 1e9) - (b.seriesPosition ?? 1e9)) ||
      (Date.parse(a.finishedAt || 0) - Date.parse(b.finishedAt || 0)))
    const first = sorted[0]
    if(first && (first.setDown || first.feeling === 'not-for-me')) out.add(key)
  }
  return out
}

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

export class RecommendError extends Error {
  constructor(type, message){ super(message); this.type = type }
}

const MESSAGES = {
  signed_out: 'Sign in to ask for a recommendation.',
  offline: 'You’re offline — this one needs a connection.',
  unauthenticated: 'Sign in to ask for a recommendation.',
  over_quota: 'That’s all for today. More tomorrow.',
  bad_key: 'That key wasn’t accepted. Check it, or remove it to use the shared one.',
  budget_exhausted: 'The recommender is resting until the 1st.',
  upstream_failure: 'Couldn’t reach the recommender just now.',
  network: 'Couldn’t reach the recommender just now.',
  none_found: 'Nothing came back that I could verify. Try again, or say more about what you want.'
}

export const messageFor = (type) => MESSAGES[type] || MESSAGES.upstream_failure

export async function askForBooks({ moods = [], freeText = '' } = {}, state){
  if(navigator.onLine === false) throw new RecommendError('offline', MESSAGES.offline)
  const token = await idToken()
  if(!token) throw new RecommendError('signed_out', MESSAGES.signed_out)

  // Their own key, if they have one — in a header, so it never lands in a URL,
  // a referrer or anything that gets written down. Absent, the header simply
  // isn't sent and the shared key and its meters apply as before.
  const own = readOwnKey()

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  let res
  try{
    res = await fetch(API_URL, {
      method: 'POST',
      signal: timer.signal,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(own ? { 'X-Reader-Key': own } : {})
      },
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
    throw new RecommendError(type, (data && data.error && data.error.message) || messageFor(type))
  }

  const raw = Array.isArray(data && data.suggestions) ? data.suggestions : []
  const abandoned = abandonedSeries(state)
  const verified = await verify(raw, state, abandoned)
  if(!verified.length) throw new RecommendError('none_found', MESSAGES.none_found)
  return { suggestions: verified, remaining: data.remaining }
}

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

    if(have.has(bookKey(match))) return null
    if(match.seriesKey && abandoned.has(match.seriesKey)) return null

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
