// Searching for a book: two sources, one ranked list.
//
// Open Library is primary — no key, stable work ids, and the identity backbone
// the whole shelf is built on. Google Books is secondary and covers its one
// real weakness: books published in the last few months, which Open Library
// lags on and which are exactly the books someone is most likely to be reading.
//
// The rest of the app never learns which source an entry came from. Everything
// public about the Book shape lives in book-shape.js and is re-exported here,
// so components have one import to reach for.
//
// Nothing here touches the DOM. The typeahead owns the UI; this owns the
// network, the merge and the ranking.
import * as openLibrary from './open-library.js'
import * as googleBooks from './google-books.js'
import { bookKey, authorsToString } from './book-shape.js'

export {
  coverUrl, FORMATS, bookKey, findExisting, genresFrom, parseSeries,
  SERIES, inSeries, sameSeries, byVolume
} from './book-shape.js'
export { isEnabled as googleBooksEnabled } from './google-books.js'

// Two characters is noise — "th" matches most of the catalogue and no ranking
// can rescue it. Three is where results become answers.
export const MIN_QUERY = 3
export const MAX_RESULTS = 6
const TIMEOUT_MS = 8000
const DEBOUNCE_MS = 250

// Asked of each source. More than is shown, so ranking has something to choose
// from, and not so much that the Open Library subject payload gets silly.
const PER_SOURCE = MAX_RESULTS * 2

export class OfflineError extends Error {}

// ── Ranking ─────────────────────────────────────────────────────────────────
// Open Library's own relevance is decent but not enough: it answers "dune" with
// Children of Dune and "educated" with Educational psychology. The book you
// typed the name of is in the results — it just isn't first. And once two
// sources are merged there is no shared relevance order left to inherit, so
// scoring stops being an improvement and becomes the only thing holding the
// list together.
//
// Sorting by popularity instead — edition_count, which the original plan called
// for — is far worse: it answers "dune" with Peril at End House, "educated"
// with Democracy and Education and "the way of kings" with the Bible, because a
// heavily reprinted classic that matches loosely outweighs what you asked for.
// Popularity may only break ties between equally good matches.

// Punctuation and case removed, so "Dune: House Atreides" and "dune house
// atreides" are the same string to compare.
function norm(s){
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// How much of what you typed turns up in the title AND author together. This is
// what makes "piranesi clarke" work: neither word is a title match, so without
// it every result ties at zero and popularity hands you A Christmas Carol. A
// word that only prefixes a longer one counts half, so the list is already
// improving at "atomi" rather than waiting for "atomic".
function coverage(words, haystack){
  if(!words.length) return 0
  const have = haystack.split(' ').filter(Boolean)
  const set = new Set(have)
  let n = 0
  for(const w of words){
    if(set.has(w)) n += 1
    else if(have.some(h => h.startsWith(w))) n += 0.5
  }
  return n / words.length
}

// Whole words only in the title tiers, which is the whole point: "educated"
// must not be counted as a match inside "educational".
function score(book, q, words){
  const t = norm(book.title)
  if(!t) return 0
  let tier = 0
  if(t === q) tier = 4
  else if(t.startsWith(q + ' ')) tier = 3                     // "Dune Messiah" for "dune"
  else if((' ' + t + ' ').includes(' ' + q + ' ')) tier = 2   // "Children of Dune"
  // Weighted so a title tier always outranks coverage alone, and coverage still
  // separates everything the tiers score as zero.
  return tier * 4 + coverage(words, norm(t + ' ' + book.author)) * 3
}

// ── Merging ─────────────────────────────────────────────────────────────────
// The same book from both sources is one book. They can't be matched on ids —
// a Google volume id and an Open Library work id are different namespaces — so
// they're matched on title+author, which is what bookKey() falls back to and
// therefore what the shelf itself would use.
//
// Open Library wins the merge because it carries the work id everything else is
// keyed on; Google fills in whatever Open Library left blank, which in practice
// is the cover on a book too new to have one.
//
// This also collapses Open Library's duplicate records for one book, which it
// has plenty of — same title, same author, two work ids. The more-printed one
// is kept as canonical. The cost is that two genuinely different books sharing
// a title AND an author (an author's two "Selected Poems", say) merge into one;
// that is rare, and the survivor is still a real book, which the alternative —
// showing near-identical rows — is not.
function pick(a, b){
  if(a.book.source !== b.book.source){
    return a.book.source === 'openlibrary' ? [a, b] : [b, a]
  }
  return a.weight >= b.weight ? [a, b] : [b, a]
}

function merge(entries){
  const byKey = new Map()
  for(const entry of entries){
    const key = bookKey({ title: entry.book.title, author: entry.book.author })
    const seen = byKey.get(key)
    if(!seen){ byKey.set(key, entry); continue }
    const [primary, other] = pick(seen, entry)
    // Fill gaps only. Never overwrite: the primary's values are the ones whose
    // provenance the rest of the app assumes.
    byKey.set(key, {
      book: { ...other.book, ...primary.book },
      weight: Math.max(seen.weight, entry.weight)
    })
  }
  return Array.from(byKey.values())
}

function ranked(entries, query){
  const q = norm(query)
  const words = q ? q.split(' ') : []
  return entries
    .map((e, i) => ({ ...e, i, s: score(e.book, q, words) }))
    .sort((a, b) =>
      (b.s - a.s) ||                       // matched what you typed better
      (b.weight - a.weight) ||             // then better known
      (a.i - b.i))                         // then the order the source gave
    .map(x => x.book)
}

// One search across every source. Rejects on abort (AbortError), on timeout and
// on Open Library failing; a Google Books failure is absorbed, because a dead
// secondary source must never take the search down with it.
export async function searchBooks(query, { signal } = {}){
  const q = String(query || '').trim()
  if(q.length < MIN_QUERY) return []
  if(navigator.onLine === false) throw new OfflineError('offline')

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  // The caller's signal and the timeout both have to be able to end this;
  // AbortSignal.any isn't universal yet, so the caller's is forwarded by hand.
  const forward = () => timer.abort()
  if(signal) signal.addEventListener('abort', forward, { once: true })
  const opts = { signal: timer.signal, limit: PER_SOURCE }

  try{
    // Both at once. Sequential would put the newest books behind a round trip
    // they don't need, and Google is only asked at all when a key exists.
    const [primary, secondary] = await Promise.allSettled([
      openLibrary.search(q, opts),
      googleBooks.search(q, opts)
    ])
    if(primary.status === 'rejected') throw primary.reason
    const found = [
      ...primary.value,
      ...(secondary.status === 'fulfilled' ? secondary.value : [])
    ]
    return ranked(merge(found), q).slice(0, MAX_RESULTS)
  } finally {
    clearTimeout(stop)
    if(signal) signal.removeEventListener('abort', forward)
  }
}

// A searcher that can be typed into.
//
// Debounce keeps a fast typist to one request per pause. Supersession is the
// separate problem underneath it: responses can arrive out of order, so a slow
// reply to "pir" must never repaint over a fast reply to "piranesi". Every
// request carries a sequence number and anything stale is dropped on arrival —
// which is what stops a stale result list surviving on screen.
//
// onState is called with one of: 'idle' | 'short' | 'searching' | 'results' |
// 'empty' | 'offline' | 'error'.
export function createBookSearch({ onResults, onState, delay = DEBOUNCE_MS } = {}){
  let timer = null
  let controller = null
  let seq = 0

  const state = (s, payload) => { if(onState) onState(s, payload) }

  function stop(){
    if(timer){ clearTimeout(timer); timer = null }
    if(controller){ controller.abort(); controller = null }
  }

  async function run(text, mine){
    controller = new AbortController()
    state('searching')
    try{
      const results = await searchBooks(text, { signal: controller.signal })
      if(mine !== seq) return                   // superseded while in flight
      if(onResults) onResults(results, text)
      state(results.length ? 'results' : 'empty')
    }catch(err){
      if(mine !== seq) return
      if(err && err.name === 'AbortError') return
      if(onResults) onResults([], text)
      state(err instanceof OfflineError || navigator.onLine === false ? 'offline' : 'error')
    }
  }

  return {
    query(text){
      stop()
      const q = String(text || '').trim()
      const mine = ++seq
      if(!q){ if(onResults) onResults([], q); state('idle'); return }
      if(q.length < MIN_QUERY){ if(onResults) onResults([], q); state('short'); return }
      timer = setTimeout(() => run(q, mine), delay)
    },
    // Abandon anything in flight and make its result stale on arrival.
    cancel(){ seq++; stop(); state('idle') }
  }
}
