// The single source of truth. Components dispatch an action and re-render when
// notified; they never mutate state or touch storage.
//
// READ THE INDEX INVARIANT in ARCHITECTURE.md before changing how commit()
// notifies. Actions identify books by POSITION, and that is only safe because
// commit() notifies synchronously and every listener re-renders in place.
import { migrate, emptyState, toStorage } from './migrate.js'
import { loadLocal, saveLocal } from './persist-local.js'
import { mergeShelf } from './merge.js'
import { bookKey, byVolume, inSeries } from '../services/book-shape.js'
import { reclaimSeries } from '../services/series-index.js'

export const CURRENT_CAP = 3

let state = emptyState()
let cloudSave = null
const listeners = new Set()

function deepFreeze(o){
  if(o && typeof o === 'object' && !Object.isFrozen(o)){
    Object.freeze(o)
    for(const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

export function getState(){ return state }

export function subscribe(fn){
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify(){ for(const fn of listeners) fn(state) }

function commit(next, { persist = true } = {}){
  state = deepFreeze(next)
  if(persist){
    saveLocal(state)
    if(cloudSave) cloudSave(state)
  }
  notify()
}

function byTitle(a, b){
  const aa = (a.title || '').toLowerCase()
  const bb = (b.title || '').toLowerCase()
  if(aa < bb) return -1
  if(aa > bb) return 1
  return 0
}

function sortedWishlist(list){ return [...list].sort(byTitle) }

// Every entry point that brings books in runs reclaimSeries() on the way past.
// It is a pure transform that returns its argument untouched when there is
// nothing to place, so this costs a walk of the shelf and no extra commit — see
// services/series-index.js for what it is undoing.
export function init(){
  const local = loadLocal()
  commit(reclaimSeries({ ...local, wishlist: sortedWishlist(local.wishlist) }), { persist: false })
}

export function reloadLocal(){
  const local = loadLocal()
  commit(reclaimSeries({ ...local, wishlist: sortedWishlist(local.wishlist) }), { persist: false })
}

// A snapshot that says what state already says is not news. Firestore delivers
// several of those per load — the cached copy, then the server's, then
// metadata-only fires (persist-cloud subscribes with includeMetadataChanges) —
// and every one of them used to rebuild every list in the app, which is what a
// hard refresh looked like: the same rows thrown away and re-created two or
// three times over.
//
// Compared through toStorage() so the two sides are normalised the same way and
// key order can't make identical shelves look different.
export function applyRemote(data){
  const next = migrate(data)
  const sorted = reclaimSeries({ ...next, wishlist: sortedWishlist(next.wishlist) })
  if(JSON.stringify(toStorage(sorted)) === JSON.stringify(toStorage(state))) return
  commit(sorted, { persist: false })
}

export function setCloudSave(fn){ cloudSave = fn || null }

export function resetAll(){
  commit(emptyState())
}

export function importShelf(raw){
  const { next, added } = mergeShelf(state, raw)
  commit(reclaimSeries({ ...next, wishlist: sortedWishlist(next.wishlist) }))
  return added
}

function withCurrent(list, extraWishlist = []){
  const displaced = list.slice(CURRENT_CAP)
  return {
    currentReads: list.slice(0, CURRENT_CAP),
    wishlist: sortedWishlist([...extraWishlist, ...displaced])
  }
}

export function addCurrent(book){
  const rest = state.wishlist
  commit({ ...state, ...withCurrent([book, ...state.currentReads], rest) })
}

export function removeCurrent(index){
  const book = state.currentReads[index]
  if(!book) return
  commit({ ...state, currentReads: state.currentReads.filter((_, i) => i !== index) })
}

export function finishCurrent(index, { feeling = null, moods = [], next = null } = {}){
  const book = state.currentReads[index]
  if(!book) return
  const entry = { ...book, finishedAt: new Date().toISOString(), feeling, moods }

  const currentReads = [...state.currentReads]
  let wishlist = state.wishlist
  if(next && next.book && !next.forthcoming){
    currentReads[index] = next.book
    if(Number.isInteger(next.fromWishlist)){
      wishlist = state.wishlist.filter((_, i) => i !== next.fromWishlist)
    }
  } else if(next && next.book){
    currentReads.splice(index, 1)
    wishlist = Number.isInteger(next.fromWishlist)
      ? state.wishlist.map((b, i) => (i === next.fromWishlist ? next.book : b))
      : [...state.wishlist, next.book]
  } else {
    currentReads.splice(index, 1)
  }

  commit({
    ...state,
    currentReads,
    wishlist: sortedWishlist(wishlist),
    finished: [entry, ...state.finished]
  })
}

const SERIES_FIELDS = ['seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal', 'seriesVolumes']

// `asked` stamps `seriesAskedAt`, which is how services/series-backfill.js knows
// it has already put this book to the Worker — including when the answer was
// "standalone", which leaves no trace on the book at all and would otherwise be
// asked again on every load forever. Stamped in the SAME commit as the answer,
// so a series arriving redraws the shelf once rather than twice.
export function applySeries(key, series, { asked = false } = {}){
  if(!key) return
  let changed = false
  const askedAt = asked ? new Date().toISOString() : null

  const patch = (book) => {
    if(!book || bookKey(book) !== key) return book
    const { seriesKey, seriesName, seriesPosition, seriesTotal, seriesVolumes, ...rest } = book
    const next = series ? { ...rest, ...series } : { ...rest }
    if(askedAt){
      if(book.seriesAskedAt !== askedAt) changed = true
      next.seriesAskedAt = askedAt
    }
    for(const f of SERIES_FIELDS){
      if(JSON.stringify(book[f]) !== JSON.stringify(next[f])){ changed = true; break }
    }
    return next
  }

  const nextState = {
    ...state,
    currentReads: state.currentReads.map(patch),
    wishlist: state.wishlist.map(patch),
    finished: state.finished.map(patch)
  }
  if(!changed) return
  // A list arriving for one book is what lets the shelf place the siblings whose
  // own lookup came back empty. Nothing else knows the list is new.
  commit(reclaimSeries(nextState))
}

export function detachSeries(seriesKey){
  if(!seriesKey) return
  const mark = (b) => (b && b.seriesKey === seriesKey && !b.seriesDetached
    ? { ...b, seriesDetached: true } : b)
  const currentReads = state.currentReads.map(mark)
  const wishlist = state.wishlist.map(mark)
  if(currentReads.every((b, i) => b === state.currentReads[i]) &&
     wishlist.every((b, i) => b === state.wishlist[i])) return
  commit({ ...state, currentReads, wishlist })
}

export function removeFinishedSeries(seriesKey){
  if(!seriesKey) return
  const rest = state.finished.filter(b => !(inSeries(b) && b.seriesKey === seriesKey))
  if(rest.length === state.finished.length) return
  commit({ ...state, finished: rest })
}

export function readAgainSeries(seriesKey){
  if(!seriesKey) return
  const volumes = state.finished.filter(b => inSeries(b) && b.seriesKey === seriesKey)
  if(!volumes.length) return
  const first = [...volumes].sort(byVolume)[0]
  const { finishedAt, feeling, moods, setDown, notes, rating, ...book } = first
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
}

// ── Details that arrive late ───────────────────────────────────────────────────
// A book added while the search was unreachable is a bare title and author wearing
// `needsDetails`. services/backfill.js fills the rest in when the network returns.
//
// workKey is deliberately NOT a detail field. bookKey() prefers workKey over
// title|author, so attaching one silently changes what the book IS — and
// mergeShelf() matches purely on that key, so a phone that had backfilled would no
// longer recognise its own book on a laptop that hadn't, and the merge would add a
// second copy instead of reconciling the one. A book keeps the identity it was
// created with.
const DETAIL_FIELDS = [
  'author', 'year', 'coverId', 'genres',
  'seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal'
]

// Legacy entries can hold '' where today's code would omit the key entirely.
const blank = (v) => v === undefined || v === null || v === ''

function patchByKey(key, patch){
  if(!key) return false
  let changed = false
  const run = (book) => {
    if(!book || bookKey(book) !== key) return book
    const next = patch(book)
    if(next === book) return book
    changed = true
    return next
  }
  const nextState = {
    ...state,
    currentReads: state.currentReads.map(run),
    wishlist: state.wishlist.map(run),
    finished: state.finished.map(run)
  }
  // The wishlist is not re-sorted: no detail field can change a title, so its
  // order is untouched and every captured index stays valid.
  if(changed) commit(nextState)
  return changed
}

export function applyDetails(key, details){
  if(!details) return false
  return patchByKey(key, (book) => {
    if(!book.needsDetails) return book          // already settled by someone else
    const next = { ...book }
    // The catalogue only fills blanks. What the reader typed is the record, and a
    // search result does not get to correct it.
    for(const f of DETAIL_FIELDS){
      if(details[f] !== undefined && blank(next[f])) next[f] = details[f]
    }
    delete next.needsDetails
    delete next.detailsTries
    return next
  })
}

// Returns true only on the try that gives up. After that the book is simply what
// it always was — a hand-typed book, which this app treats as a first-class
// citizen, indistinguishable from one the search never knew.
export function noteDetailsMiss(key, max){
  let gaveUp = false
  patchByKey(key, (book) => {
    if(!book.needsDetails) return book
    const tries = (book.detailsTries || 0) + 1
    if(tries < max) return { ...book, detailsTries: tries }
    gaveUp = true
    const { needsDetails, detailsTries, ...rest } = book
    return rest
  })
  return gaveUp
}

// The reader named the book by hand, so the catalogue entry wins outright — the
// title included, which is the entire point when the reason nothing matched was a
// typo in it. Only what the SHELF knows, as opposed to what the catalogue knows,
// survives: how it felt, when it was finished, what it was tagged.
//
// This DOES change the book's identity when the title changes, which is the thing
// applyDetails() refuses to do. That's the trade: here it is a deliberate act by
// the reader on one book, not something that happens to a shelf unattended.
const READER_FIELDS = [
  'moods', 'feeling', 'finishedAt', 'setDown', 'notes', 'rating', 'format', 'seriesDetached'
]

export function replaceBook(key, book){
  if(!key || !book || !book.title) return false
  let changed = false
  const run = (entry) => {
    if(!entry || bookKey(entry) !== key) return entry
    changed = true
    const { workKey, source, ...rest } = book
    const next = { ...rest }
    for(const f of READER_FIELDS) if(entry[f] !== undefined) next[f] = entry[f]
    return next
  }
  const nextState = {
    ...state,
    currentReads: state.currentReads.map(run),
    wishlist: sortedWishlist(state.wishlist.map(run)),
    finished: state.finished.map(run)
  }
  if(changed) commit(nextState)
  return changed
}

export function reorderCurrent(from, to){
  const list = state.currentReads
  if(from === to) return
  if(from < 0 || from >= list.length) return
  const target = Math.max(0, Math.min(to, list.length - 1))
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  commit({ ...state, currentReads: next })
}

export function setDownCurrent(index, { outcome = 'later' } = {}){
  const book = state.currentReads[index]
  if(!book) return
  const rest = state.currentReads.filter((_, i) => i !== index)

  if(outcome === 'never'){
    const entry = { ...book, setDown: true, finishedAt: new Date().toISOString() }
    commit({ ...state, currentReads: rest, finished: [entry, ...state.finished] })
    return
  }

  commit({
    ...state,
    currentReads: rest,
    wishlist: sortedWishlist([...state.wishlist, { ...book }])
  })
}

export function addToTbr(book){
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
}

export function removeTbr(index){
  commit({ ...state, wishlist: state.wishlist.filter((_, i) => i !== index) })
}

export function makeTbrCurrent(index){
  const book = state.wishlist[index]
  if(!book) return
  const rest = state.wishlist.filter((_, i) => i !== index)
  commit({ ...state, ...withCurrent([book, ...state.currentReads], rest) })
}

export function passSuggestion(book){
  if(!book || !book.title) return
  commit({ ...state, passed: [...state.passed, { title: book.title, author: book.author || '' }] })
}

export function addAlreadyRead(book){
  if(!book || !book.title) return
  commit({ ...state, finished: [{ ...book }, ...state.finished] })
}

export function readAgain(index){
  const item = state.finished[index]
  if(!item) return
  const { finishedAt, feeling, moods, setDown, notes, rating, ...book } = item
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
}

export function removeFinished(index){
  commit({ ...state, finished: state.finished.filter((_, i) => i !== index) })
}

export function addLibrary(entry){
  commit({ ...state, library: [...state.library, entry] })
}

export function editLibrary(index, entry){
  commit({ ...state, library: state.library.map((e, i) => (i === index ? entry : e)) })
}

export function removeLibrary(index){
  commit({ ...state, library: state.library.filter((_, i) => i !== index) })
}

export function reorderLibrary(from, to){
  const list = state.library
  if(from === to) return
  if(from < 0 || from >= list.length) return
  const target = Math.max(0, Math.min(to, list.length - 1))
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  commit({ ...state, library: next })
}

export function addBookstore(entry){
  commit({ ...state, bookstores: [...state.bookstores, entry] })
}

export function editBookstore(index, entry){
  commit({ ...state, bookstores: state.bookstores.map((e, i) => (i === index ? entry : e)) })
}

export function removeBookstore(index){
  commit({ ...state, bookstores: state.bookstores.filter((_, i) => i !== index) })
}

export function setVibe(id){
  if(state.vibe === id) return
  commit({ ...state, vibe: id })
}

export function setFindLinks(links){
  const next = Array.isArray(links) ? links : []
  if(next.join() === (state.findLinks || []).join()) return
  commit({ ...state, findLinks: next })
}

export function setBorrowFormats(formats){
  const next = Array.isArray(formats) ? formats : []
  if(next.join() === (state.borrowFormats || []).join()) return
  commit({ ...state, borrowFormats: next })
}
