// Series travel together. Asked ONCE, for the WHOLE series, at add time — and,
// for a book that was on the shelf before this existed or whose one lookup found
// no network, once more by services/series-backfill.js.
//
// Asking per-book ("what comes next?") needed six consecutive correct answers to
// cross a seven-book series and died three books in; see ARCHITECTURE.md > Series.
// Holding the list makes nextVolume() pure array indexing over data already on the
// book — no network when a volume is finished.
//
// lookup() returns { answered, series }. Never collapse those into a bare null: a
// Worker that could not be reached must not strip series data the catalogue gave.
import { idToken } from '../state/auth.js'
import { API_BASE } from './recommend.js'
import { bookKey, SERIES, inSeries } from './book-shape.js'
import { applySeries } from '../state/store.js'

export { SERIES } from './book-shape.js'

export const SERIES_URL = `${API_BASE}/series`

const TIMEOUT_MS = 15000

export async function lookup(book){
  if(!SERIES || !book || !book.title) return { answered: false }
  if(navigator.onLine === false) return { answered: false }

  let token = null
  try{ token = await idToken() }catch(e){ return { answered: false } }
  if(!token) return { answered: false }

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  try{
    const res = await fetch(SERIES_URL, {
      method: 'POST',
      signal: timer.signal,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: book.title, author: book.author || '' })
    })
    // The STATUS travels with a refusal. 429 is the Worker saying "not today"
    // and means something different from a blip: services/series-backfill.js
    // has to stand down rather than keep sweeping into a closed door and
    // spending the ceiling that adding a book needs.
    if(!res.ok) return { answered: false, status: res.status }
    const data = await res.json()
    return { answered: true, series: fields(data && data.series) }
  }catch(err){
    return { answered: false }
  }finally{
    clearTimeout(stop)
  }
}

function fields(series){
  if(!series || !series.key || !series.name) return null
  const volumes = Array.isArray(series.volumes)
    ? series.volumes.filter(v => v && v.title)
    : []
  if(volumes.length < 2) return null
  const out = {
    seriesKey: String(series.key),
    seriesName: String(series.name),
    seriesVolumes: volumes
  }
  if(Number.isFinite(series.position) && series.position > 0) out.seriesPosition = series.position
  if(Number.isFinite(series.total) && series.total > 0) out.seriesTotal = series.total
  return out
}

// `asked: true` records that this book has now been put to the Worker, answer or
// no answer — the mark services/series-backfill.js reads to know it does not
// have to ask again. A "standalone" answer changes nothing else about the book,
// so without the stamp there is no way to tell it apart from never having asked.
export function enrich(book){
  if(!SERIES || !book || !book.title) return
  const key = bookKey(book)
  if(!key) return
  lookup(book)
    .then(({ answered, series }) => { if(answered) applySeries(key, series, { asked: true }) })
    .catch(() => {})
}

const SERIES_FIELDS = ['seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal', 'seriesVolumes']

function seriesOnly(book){
  const out = {}
  for(const f of SERIES_FIELDS) if(book[f] !== undefined) out[f] = book[f]
  return out
}

function volumeAt(from, position){
  const record = from.seriesVolumes[position - 1]
  const { verified, ...rest } = record
  return {
    ...rest,
    seriesKey: from.seriesKey,
    seriesName: from.seriesName,
    seriesPosition: position,
    seriesTotal: from.seriesTotal,
    seriesVolumes: from.seriesVolumes
  }
}

function forthcoming(volume){
  return Number.isFinite(volume.year) && volume.year > new Date().getFullYear()
}

export function nextVolume(book, state){
  if(!inSeries(book)) return null
  if(!Array.isArray(book.seriesVolumes) || !book.seriesVolumes.length) return null
  if(!Number.isFinite(book.seriesPosition)) return null

  const read = new Map()
  for(const b of state.finished || []) read.set(bookKey(b), b)
  if(read.has(bookKey(book))) return null          // a re-read

  for(let position = book.seriesPosition + 1; position <= book.seriesVolumes.length; position++){
    const record = book.seriesVolumes[position - 1]
    if(!record) return null
    if(!record.verified) return null               // never invent

    const volume = volumeAt(book, position)
    const key = bookKey(volume)
    if(read.has(key)) continue                     // already read — try the one after

    const soon = forthcoming(record)
    const onPile = (state.wishlist || []).findIndex(b => bookKey(b) === key)
    if(onPile !== -1){
      return {
        book: { ...state.wishlist[onPile], ...seriesOnly(volume) },
        fromWishlist: onPile,
        forthcoming: soon
      }
    }
    return { book: volume, fromWishlist: null, forthcoming: soon }
  }
  return null                                       // end of the series
}

// The record's copy of the same walk, for a series someone finished before the
// app knew it was one.
//
// nextVolume() is the finish modal's announcement, and it refuses a re-read —
// a book already in the record advances nothing. That refusal is right at the
// point of finishing and wrong afterwards: services/series-backfill.js can hand
// a book its series days later, by which time the one moment the app had to say
// "there is a book 2" has already passed. This is the second and last place it
// can be said, so the re-read guard is the ONE rule that differs.
//
// It offers, and never promotes. A volume already on Current Reads or the pile
// is nothing to announce — the reader has it — so this returns null rather than
// moving anything, and the only action the record ever takes is adding to the
// pile.
export function unreadVolume(book, state){
  if(!inSeries(book)) return null
  // "Not for me" never advances a series — the same rule setDownCurrent() keeps
  // by simply never calling nextVolume(). Here the entry is already in the
  // record wearing its setDown flag, so the rule has to be said out loud.
  if(book.setDown) return null
  if(!Array.isArray(book.seriesVolumes) || !book.seriesVolumes.length) return null
  if(!Number.isFinite(book.seriesPosition)) return null

  const read = new Set()
  for(const b of state.finished || []) read.add(bookKey(b))
  const held = new Set()
  for(const b of [...(state.currentReads || []), ...(state.wishlist || [])]) held.add(bookKey(b))

  for(let position = book.seriesPosition + 1; position <= book.seriesVolumes.length; position++){
    const record = book.seriesVolumes[position - 1]
    if(!record) return null
    if(!record.verified) return null               // never invent
    if(forthcoming(record)) return null            // not out yet; nothing to add
    const volume = volumeAt(book, position)
    const key = bookKey(volume)
    if(read.has(key)) continue                     // already read — try the one after
    if(held.has(key)) return null                  // already waiting for them
    return volume
  }
  return null                                       // end of the series
}
