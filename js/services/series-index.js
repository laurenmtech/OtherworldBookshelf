// A book that is in a series, sitting on the shelf, and does not know it.
//
// Every book asks the Worker about its own series independently. shape() in
// api/src/series.js then throws away any answer whose volume list does not
// contain the title it asked about — the guard that catches "Heir of Fire →
// Crescent City", and the reason that class of wrong answer never reaches a
// shelf. The guard is right, but it fails CLOSED: the book lands with no
// seriesKey at all, toRows() draws it as a standalone next to the very series
// it belongs to, and cachePolicy() files the null answer as 'soft' so it stays
// that way for thirty days.
//
// One reader hit it with Throne of Glass: four volumes grouped, and Heir of
// Fire, Tower of Dawn and Kingdom of Ash loose beneath them. The prompt's own
// "companion volumes do not belong in the list" rule is enough to lose Tower of
// Dawn, which runs parallel to Empire of Storms and is often described that way.
//
// The answer was already on the shelf. Every sibling whose lookup DID work
// carries seriesVolumes — the whole list, each title checked against Open
// Library — and the book that missed is in it, by title. So place it from the
// list we are already holding rather than asking again: no network, and no
// second chance to be wrong.
//
// Two rules stop this from inventing anything:
//
//   1. ONLY A VERIFIED VOLUME MAY CLAIM A BOOK. The same rule nextVolume()
//      advances by — an unverified record is a title a model typed, and nothing
//      has confirmed the book exists.
//   2. THE AUTHOR MUST AGREE. "Heir of Fire" is unambiguous; "Babel" is not,
//      and a series must never swallow an unrelated book that shares a title.
import { inSeries, norm, sameTitle } from './book-shape.js'

const LISTS = ['currentReads', 'wishlist', 'finished']

// Every series the shelf can currently speak for, keyed by seriesKey.
//
// The LONGEST list wins when two books disagree about their own series. A
// lookup that dropped Tower of Dawn as a companion volume returns six titles
// where another returns seven, and taking the six would strand the book it
// dropped — the exact failure this module exists to undo.
export function seriesIndex(lists){
  const index = new Map()
  for(const list of lists || []){
    for(const book of list || []){
      if(!inSeries(book)) continue
      const volumes = book.seriesVolumes
      if(!Array.isArray(volumes) || volumes.length < 2) continue
      const held = index.get(book.seriesKey)
      if(held && held.seriesVolumes.length >= volumes.length) continue
      const entry = {
        seriesKey: book.seriesKey,
        seriesName: book.seriesName,
        seriesVolumes: volumes
      }
      if(Number.isFinite(book.seriesTotal)) entry.seriesTotal = book.seriesTotal
      index.set(book.seriesKey, entry)
    }
  }
  return index
}

// Containment by WHOLE WORD, so "Maas" matches "Sarah J. Maas" while "King"
// does not match "Barbara Kingsolver" — the same call backfill.js makes about a
// result it is deciding whether to trust. Either side missing an author cannot
// contradict the other, so it agrees.
function authorAgrees(book, volume){
  const want = norm(book && book.author)
  const have = norm(volume && volume.author)
  if(!want || !have) return true
  const words = new Set(have.split(' ').filter(Boolean))
  return want.split(' ').filter(Boolean).every(w => words.has(w))
}

// The series fields a loose book should be wearing, or null to leave it alone.
export function placeIn(index, book){
  // Only a book carrying NO key at all. One that already has a series is not
  // this function's business, and a detached volume was detached on purpose.
  if(!book || !book.title || book.seriesKey || book.seriesDetached) return null
  for(const series of index.values()){
    const at = series.seriesVolumes.findIndex(v =>
      v && v.verified && sameTitle(v.title, book.title))
    if(at === -1) continue
    if(!authorAgrees(book, series.seriesVolumes[at])) continue
    const out = {
      seriesKey: series.seriesKey,
      seriesName: series.seriesName,
      seriesPosition: at + 1,
      seriesVolumes: series.seriesVolumes
    }
    if(Number.isFinite(series.seriesTotal)) out.seriesTotal = series.seriesTotal
    return out
  }
  return null
}

// Returns the SAME object when nothing was placed. That is what lets store.js
// run this on every load and every arriving answer without turning a quiet
// snapshot into news — see applyRemote() and ARCHITECTURE.md > Redraws.
//
// Idempotent by construction: a book this places comes back holding a
// seriesKey, and placeIn() then declines it.
export function reclaimSeries(state){
  if(!state) return state
  const index = seriesIndex(LISTS.map(l => state[l]))
  if(!index.size) return state

  let changed = false
  const next = { ...state }
  for(const list of LISTS){
    const books = state[list]
    if(!Array.isArray(books)) continue
    next[list] = books.map(book => {
      const found = placeIn(index, book)
      if(!found) return book
      changed = true
      return { ...book, ...found }
    })
  }
  return changed ? next : state
}
