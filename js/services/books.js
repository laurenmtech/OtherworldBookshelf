// Searching: two sources, one ranked list. Open Library is primary (stable work
// ids); Google Books covers its weakness on books published in the last months.
//
// Ranking is by how well a result matches what you typed. Sorting by popularity
// instead is far worse — it answers "dune" with Peril at End House. Popularity may
// only break ties.
import * as openLibrary from './open-library.js'
import * as googleBooks from './google-books.js'
import { bookKey, authorsToString } from './book-shape.js'

export {
  coverUrl, FORMATS, bookKey, findExisting, genresFrom, parseSeries,
  SERIES, inSeries, sameSeries, byVolume
} from './book-shape.js'
export { isEnabled as googleBooksEnabled } from './google-books.js'

export const MIN_QUERY = 3
export const MAX_RESULTS = 6
const TIMEOUT_MS = 8000
const DEBOUNCE_MS = 250

const PER_SOURCE = MAX_RESULTS * 2

export class OfflineError extends Error {}

function norm(s){
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

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

function score(book, q, words){
  const t = norm(book.title)
  if(!t) return 0
  let tier = 0
  if(t === q) tier = 4
  else if(t.startsWith(q + ' ')) tier = 3                     // "Dune Messiah" for "dune"
  else if((' ' + t + ' ').includes(' ' + q + ' ')) tier = 2   // "Children of Dune"
  return tier * 4 + coverage(words, norm(t + ' ' + book.author)) * 3
}

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

export async function searchBooks(query, { signal } = {}){
  const q = String(query || '').trim()
  if(q.length < MIN_QUERY) return []
  if(navigator.onLine === false) throw new OfflineError('offline')

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  const forward = () => timer.abort()
  if(signal) signal.addEventListener('abort', forward, { once: true })
  const opts = { signal: timer.signal, limit: PER_SOURCE }

  try{
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
    cancel(){ seq++; stop(); state('idle') }
  }
}
