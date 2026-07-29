// The single source of truth for the shelf.
// Components never touch localStorage or Firestore and never mutate state —
// they dispatch an action and re-render when notified.
import { migrate, emptyState } from './migrate.js'
import { loadLocal, saveLocal } from './persist-local.js'

// How many books may be current at once. Phase 3 raises this to 3 and adds the
// list UI; until then adding a current read replaces the one that was there,
// which is exactly what the single-slot card has always done.
const CURRENT_CAP = 1

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

// persist:false is for state that came *from* storage — applying a remote
// snapshot must not immediately write it back.
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

// ---------- lifecycle ----------

export function init(){
  const local = loadLocal()
  commit({ ...local, wishlist: sortedWishlist(local.wishlist) }, { persist: false })
}

// Signed out, or the cloud told us nothing — go back to the local copy.
export function reloadLocal(){
  const local = loadLocal()
  commit({ ...local, wishlist: sortedWishlist(local.wishlist) }, { persist: false })
}

// A remote snapshot replaces the in-memory shelf. Never written back.
export function applyRemote(data){
  const next = migrate(data)
  commit({ ...next, wishlist: sortedWishlist(next.wishlist) }, { persist: false })
}

// Called by persist-cloud on sign-in/out. null = local only.
export function setCloudSave(fn){ cloudSave = fn || null }

// ---------- current reads ----------

export function addCurrent(book){
  const next = [book, ...state.currentReads].slice(0, CURRENT_CAP)
  commit({ ...state, currentReads: next })
}

export function editCurrent(index, book){
  const next = state.currentReads.map((b, i) => (i === index ? book : b))
  commit({ ...state, currentReads: next })
}

export function finishCurrent(index, { feeling = null, moods = [] } = {}){
  const book = state.currentReads[index]
  if(!book) return
  const entry = { ...book, finishedAt: new Date().toISOString(), feeling, moods }
  commit({
    ...state,
    currentReads: state.currentReads.filter((_, i) => i !== index),
    finished: [entry, ...state.finished]
  })
}

// ---------- TBR pile ----------

export function addToTbr(book){
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
}

export function editTbr(index, book){
  const next = state.wishlist.map((b, i) => (i === index ? book : b))
  commit({ ...state, wishlist: sortedWishlist(next) })
}

export function removeTbr(index){
  commit({ ...state, wishlist: state.wishlist.filter((_, i) => i !== index) })
}

// Promote a TBR entry to the current read, taking it off the pile.
export function makeTbrCurrent(index){
  const book = state.wishlist[index]
  if(!book) return
  commit({
    ...state,
    wishlist: state.wishlist.filter((_, i) => i !== index),
    currentReads: [book, ...state.currentReads].slice(0, CURRENT_CAP)
  })
}

// ---------- finished ----------

export function removeFinished(index){
  commit({ ...state, finished: state.finished.filter((_, i) => i !== index) })
}

// ---------- library ----------

export function addLibrary(entry){
  commit({ ...state, library: [...state.library, entry] })
}

export function editLibrary(index, entry){
  commit({ ...state, library: state.library.map((e, i) => (i === index ? entry : e)) })
}

export function removeLibrary(index){
  commit({ ...state, library: state.library.filter((_, i) => i !== index) })
}

// Existing behaviour, preserved: a library entry becomes a current book with
// its name as the title and its URL as the author.
export function makeLibraryCurrent(index){
  const it = state.library[index]
  if(!it) return
  addCurrent({ title: it.name, author: it.url })
}
