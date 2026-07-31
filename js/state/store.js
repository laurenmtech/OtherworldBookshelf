// The single source of truth for the shelf.
// Components never touch localStorage or Firestore and never mutate state —
// they dispatch an action and re-render when notified.
//
// ── The index invariant ─────────────────────────────────────────────────────
// Almost every action here identifies a book by its POSITION in a list —
// removeFinished(index), readAgain(index), removeTbr(index), editLibrary(index).
// Those positions are captured in render closures, so they are only ever
// correct because of one rule:
//
//     commit() notifies SYNCHRONOUSLY, and every listener re-renders in place.
//
// That is what guarantees a button can't outlive the list it was drawn from.
// A remote snapshot arriving mid-session (persist-cloud.js) re-renders too, so
// the handler holding a stale index is destroyed before anyone can tap it.
//
// Break that rule — batch renders into a rAF, debounce a listener, put a
// diffing layer in front of the DOM — and every action on this page starts
// removing the wrong book. Silently. bookKey() in services/book-shape.js is the
// real identity and is already stamped on every row as data-book-key; that is
// where to go if this ever needs to stop being positional.
import { migrate, emptyState } from './migrate.js'
import { loadLocal, saveLocal } from './persist-local.js'
import { bookKey, byVolume, inSeries } from '../services/book-shape.js'

// How many books may be current at once. Phase 4 brought the list UI, so this
// is 3. Nothing refuses a fourth — see withCurrent().
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

// Finishing a book, and — when it's a volume of a series — advancing the entry
// to the next one IN PLACE rather than adding a second entry beside it. That
// in-place swap is the whole reason a series occupies one slot on Current Reads
// however long it runs; the cap never has to know series exist.
//
// `next` comes from nextVolume() in services/series.js, which owns every rule
// about whether there is a next volume at all. This function only moves things.
// A null next is the ordinary case and behaves exactly as it always has.
export function finishCurrent(index, { feeling = null, moods = [], next = null } = {}){
  const book = state.currentReads[index]
  if(!book) return
  const entry = { ...book, finishedAt: new Date().toISOString(), feeling, moods }

  const currentReads = [...state.currentReads]
  let wishlist = state.wishlist
  if(next && next.book && !next.forthcoming){
    currentReads[index] = next.book
    // Promoted, not duplicated: a next volume already on the pile leaves it.
    if(Number.isInteger(next.fromWishlist)){
      wishlist = state.wishlist.filter((_, i) => i !== next.fromWishlist)
    }
  } else if(next && next.book){
    // The next volume isn't out yet, so the series entry leaves Current Reads
    // the way any finished book does and the forthcoming volume waits on the
    // pile. Updated in place when it's already there rather than added twice.
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

// ---- series ----

// The answer from the series lookup, landing late.
//
// Patched by bookKey rather than by position because the lookup is fired and
// forgotten at add time: by the time it returns, the book may have moved, been
// finished, or been removed. Every copy is patched, in every list, because the
// same book can legitimately be on the pile and in the record at once.
//
// `series` null means the lookup said "not a series", and that CLEARS whatever
// the free Open Library parser guessed — the Worker is the authority when it
// answers, and the parser is only there for when it can't be reached. A lookup
// that failed never gets here; enrich() drops those.
//
// seriesDetached survives untouched — it isn't one of the fields replaced, so a
// reader who said stop has not un-said it by being handed a fresh answer about
// the series.
const SERIES_FIELDS = ['seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal', 'seriesVolumes']

export function applySeries(key, series){
  if(!key) return
  let changed = false

  const patch = (book) => {
    if(!book || bookKey(book) !== key) return book
    const { seriesKey, seriesName, seriesPosition, seriesTotal, seriesVolumes, ...rest } = book
    const next = series ? { ...rest, ...series } : rest
    // Compare the series fields specifically rather than the whole book. A
    // whole-object compare would have to be order-insensitive to be right —
    // rebuilding an object reorders its keys — and these are the only fields
    // this function can change anyway. Getting it wrong would mean every
    // no-op answer writing to storage and syncing to the cloud.
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

// "Stop handing me volumes of this."
//
// A reader who wants to stop at book 3, or who is reading out of order, or who
// was offered the wrong next book, is never argued with. Detaching marks every
// copy of the series that's still ahead of them — on Current Reads and on the
// pile — so nothing advances and nothing groups.
//
// The RECORD is deliberately untouched. Detaching says "this isn't a series to
// me going forward"; it does not say "un-group the seven books I already read",
// and silently rearranging someone's history to answer a different question
// would be the app overreaching.
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

// Everything in the record belonging to one series. The confirmation that names
// the count lives in the row that calls this — a single control that can delete
// seven books has to say so before it does.
export function removeFinishedSeries(seriesKey){
  if(!seriesKey) return
  const rest = state.finished.filter(b => !(inSeries(b) && b.seriesKey === seriesKey))
  if(rest.length === state.finished.length) return
  commit({ ...state, finished: rest })
}

// "Read again" on a series row: the earliest volume in the record goes back on
// the pile CARRYING its series fields, so starting it re-forms the series entry
// and advancing works again. Re-reading a series means reading it from the
// start, and the record is left exactly as it stands — both are true at once.
//
// The earliest volume we HAVE, not book 1: someone who only ever read books 3
// to 7 is handed book 3, because inventing a book 1 we've never seen would be
// inventing a fact.
export function readAgainSeries(seriesKey){
  if(!seriesKey) return
  const volumes = state.finished.filter(b => inSeries(b) && b.seriesKey === seriesKey)
  if(!volumes.length) return
  const first = [...volumes].sort(byVolume)[0]
  const { finishedAt, feeling, moods, setDown, notes, rating, ...book } = first
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
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
//   'later' — not right now. Back on the TBR pile, exactly as it was, still
//             suggestible and with no mark against it.
//   'never' — not for me. Into the record, marked setDown so it renders
//             distinctly and can be filtered, and excluded from future
//             suggestions (Phase 8 reads this flag; nothing else may).
//
// The outcome is the only question. How it felt and what its vibes were belong
// to finishing a book — asking them here would make stopping something you have
// to account for, and the point of this action is that it costs nothing to be
// honest about abandoning a book. Older entries may still carry a feeling from
// when it was asked; the record renders them either way.
//
// NEITHER OUTCOME ADVANCES A SERIES, and that's the point rather than an
// oversight. Being handed book 2 of something you just gave up on is the app
// arguing with you — abandonedSeries() in the recommender already encodes
// exactly this rule for suggestions. A pause is a pause: the book goes back on
// the pile at the volume it was on, and picking it up again resumes from there.
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

// ---------- TBR pile ----------

export function addToTbr(book){
  commit({ ...state, wishlist: sortedWishlist([...state.wishlist, book]) })
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

// The FIRST library is the primary one, and it's the one availability is
// checked against — so like reorderCurrent, this is content rather than a
// local view preference.
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

// Which links appear under a book you haven't got yet. A preference, so it
// follows you to a second device.
export function setFindLinks(links){
  const next = Array.isArray(links) ? links : []
  if(next.join() === (state.findLinks || []).join()) return
  commit({ ...state, findLinks: next })
}

// Which formats you'd actually borrow. A preference, so it follows you to a
// second device.
export function setBorrowFormats(formats){
  const next = Array.isArray(formats) ? formats : []
  if(next.join() === (state.borrowFormats || []).join()) return
  commit({ ...state, borrowFormats: next })
}
