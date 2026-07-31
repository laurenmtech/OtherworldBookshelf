// The single source of truth. Components dispatch an action and re-render when
// notified; they never mutate state or touch storage.
//
// READ THE INDEX INVARIANT in ARCHITECTURE.md before changing how commit()
// notifies. Actions identify books by POSITION, and that is only safe because
// commit() notifies synchronously and every listener re-renders in place.
import { migrate, emptyState } from './migrate.js'
import { loadLocal, saveLocal } from './persist-local.js'
import { mergeShelf } from './merge.js'
import { bookKey, byVolume, inSeries } from '../services/book-shape.js'

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

export function init(){
  const local = loadLocal()
  commit({ ...local, wishlist: sortedWishlist(local.wishlist) }, { persist: false })
}

export function reloadLocal(){
  const local = loadLocal()
  commit({ ...local, wishlist: sortedWishlist(local.wishlist) }, { persist: false })
}

export function applyRemote(data){
  const next = migrate(data)
  commit({ ...next, wishlist: sortedWishlist(next.wishlist) }, { persist: false })
}

export function setCloudSave(fn){ cloudSave = fn || null }

export function resetAll(){
  commit(emptyState())
}

export function importShelf(raw){
  const { next, added } = mergeShelf(state, raw)
  commit({ ...next, wishlist: sortedWishlist(next.wishlist) })
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

export function applySeries(key, series){
  if(!key) return
  let changed = false

  const patch = (book) => {
    if(!book || bookKey(book) !== key) return book
    const { seriesKey, seriesName, seriesPosition, seriesTotal, seriesVolumes, ...rest } = book
    const next = series ? { ...rest, ...series } : rest
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
  commit(nextState)
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

export function makeLibraryCurrent(index){
  const it = state.library[index]
  if(!it) return
  addCurrent({ title: it.name, author: it.url })
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
