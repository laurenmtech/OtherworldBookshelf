// Series travel together. Asked ONCE, at add time, for the WHOLE series.
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
    if(!res.ok) return { answered: false }
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

export function enrich(book){
  if(!SERIES || !book || !book.title) return
  const key = bookKey(book)
  if(!key) return
  lookup(book)
    .then(({ answered, series }) => { if(answered) applySeries(key, series) })
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
