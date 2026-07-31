// The single source of truth for the shelf.
// Components never touch localStorage or Firestore and never mutate state —
// they dispatch an action and re-render when notified.
import { migrate, emptyState } from './migrate.js'
import { loadLocal, saveLocal } from './persist-local.js'

// How many books may be current at once. Phase 4 brought the list UI, so this
// is 3. Nothing refuses a fourth: withCurrent() sets whatever no longer fits
// back on the TBR pile, and the add flow says which book that will be before
// you commit to it.
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

// Wipe the shelf. Persisted like any other change, which is the point: signed
// in, this propagates the deletion to the cloud and every other device. The
// settings sheet is responsible for confirming before calling it.
export function resetAll(){
  commit(emptyState())
}

// ---------- current reads ----------

// Whatever no longer fits in currentReads goes back on the TBR pile instead of
// vanishing — quietly deleting a book someone is part-way through is the single
// most destructive thing this app could do. At CURRENT_CAP 3 that only bites on
// a fourth book, and the add flow warns first.
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

export function editCurrent(index, book){
  const next = state.currentReads.map((b, i) => (i === index ? book : b))
  commit({ ...state, currentReads: next })
}

// Taking a book off the shelf without saying anything about it: a mis-add, a
// wrong edition, a book you'd rather not have a record of. Deliberately NOT the
// same as finishing or setting down — those both write to the record, and this
// writes nothing at all. Nothing displaced comes back, because nothing was
// displaced by removing.
export function removeCurrent(index){
  const book = state.currentReads[index]
  if(!book) return
  commit({ ...state, currentReads: state.currentReads.filter((_, i) => i !== index) })
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

// Move a current read to a new position. Which book is first is not cosmetic —
// the first entry is the one rendered large — so this is content, persisted and
// synced like anything else.
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

// Setting a book down, which is not the same as finishing it and not the same
// as never having started.
//
//   'later' — not right now. Back on the TBR pile, still suggestible, no mark
//             against it. Any feeling or vibes given ride along, so picking it
//             up again comes with the note you left yourself.
//   'never' — not for me. Into the record, marked setDown so it renders
//             distinctly and can be filtered, and excluded from future
//             suggestions (Phase 8 reads this flag; nothing else may).
//
// Feeling and vibes are optional on both — the point of this action is that it
// costs nothing to be honest about abandoning a book.
export function setDownCurrent(index, { outcome = 'later', feeling = null, moods = [] } = {}){
  const book = state.currentReads[index]
  if(!book) return
  const rest = state.currentReads.filter((_, i) => i !== index)

  if(outcome === 'never'){
    const entry = {
      ...book, setDown: true, finishedAt: new Date().toISOString(), feeling, moods
    }
    commit({ ...state, currentReads: rest, finished: [entry, ...state.finished] })
    return
  }

  const shelved = { ...book }
  if(feeling) shelved.feeling = feeling
  if(moods && moods.length) shelved.moods = moods
  commit({
    ...state,
    currentReads: rest,
    wishlist: sortedWishlist([...state.wishlist, shelved])
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

// Promote a TBR entry to the current read, taking it off the pile. Any book it
// displaces takes its place on the pile — a swap, not an overwrite.
export function makeTbrCurrent(index){
  const book = state.wishlist[index]
  if(!book) return
  const rest = state.wishlist.filter((_, i) => i !== index)
  commit({ ...state, ...withCurrent([book, ...state.currentReads], rest) })
}

// ---------- suggestions ----------

// A book you were offered and didn't want. Kept so a second ask returns
// genuinely different books rather than the same five with new wording — and
// kept forever, because "not this one" doesn't expire.
export function passSuggestion(book){
  if(!book || !book.title) return
  commit({ ...state, passed: [...state.passed, { title: book.title, author: book.author || '' }] })
}

// "I've already read this." Goes into the record with NO finishedAt — we know
// they read it, we have no idea when, and stamping today's date on a book from
// years ago would be inventing a fact. The Finished list already renders undated
// entries without a date and sorts them below dated ones.
export function addAlreadyRead(book){
  if(!book || !book.title) return
  commit({ ...state, finished: [{ ...book }, ...state.finished] })
}

// ---------- finished ----------

// Re-reading a book does not un-read it. The record keeps the entry exactly as
// it stands — the date, the feeling, the vibes — and a clean copy goes on the
// pile. Both are true at once: you have read it, and it is what's next. The
// finish metadata is stripped on the way over so the TBR entry is a book again
// rather than a half-erased memory of finishing it.
export function readAgain(index){
  const item = state.finished[index]
  if(!item) return
  const { finishedAt, feeling, moods, setDown, notes, rating, ...book } = item
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
}

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

// Order matters here the same way it does for current reads: the FIRST library
// is the primary one, and it's the one availability is checked against. So
// reordering is content, persisted and synced, not a local view preference.
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

// Existing behaviour, preserved: a library entry becomes a current book with
// its name as the title and its URL as the author.
export function makeLibraryCurrent(index){
  const it = state.library[index]
  if(!it) return
  addCurrent({ title: it.name, author: it.url })
}

// ---------- bookstores ----------
// Same shape as a library entry. Phase 5 is where these grow real availability
// and buy links; for now they're a list of places you like.

export function addBookstore(entry){
  commit({ ...state, bookstores: [...state.bookstores, entry] })
}

export function editBookstore(index, entry){
  commit({ ...state, bookstores: state.bookstores.map((e, i) => (i === index ? entry : e)) })
}

export function removeBookstore(index){
  commit({ ...state, bookstores: state.bookstores.filter((_, i) => i !== index) })
}

// ---------- preferences ----------

// Which vibe the library wears. Persisted like anything else, so signing in on
// a second device brings your look with you. js/vibes/apply.js watches for it.
export function setVibe(id){
  if(state.vibe === id) return
  commit({ ...state, vibe: id })
}

// Which formats you'd actually borrow. A preference, so it follows you to a
// second device — and like `vibe`, it must never count as content in
// isEmptyState(), or "I read ebooks" could overwrite an unsynced shelf.
// Which links appear under a book you haven't got yet. A preference, so it
// follows you to a second device — and like the others, it must never count as
// content in isEmptyState().
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
