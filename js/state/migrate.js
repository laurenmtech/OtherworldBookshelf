// Forward migrations. Every one must be safe to run twice — this runs on every
// load, on local data and on each remote snapshot.
//
// There is deliberately no version number, here or in storage. Every migration
// below reads the shape it finds and normalises it, so a document written by
// any past build is understood without being asked what it is — which is the
// only thing that works when the writer might be a phone that hasn't opened
// the app in a year. A stamped version would have to be trusted, and a
// document whose stamp disagrees with its shape is worse than no stamp.

// The formats you'd actually borrow. Defaults to ebook alone — see
// availability() in services/libby.js for why the narrower default is kinder.
export const BORROW_FORMATS = ['ebook', 'audiobook']
const DEFAULT_BORROW_FORMATS = ['ebook']

// Where to look for a book you haven't got yet. Both by default — a new reader
// shouldn't have to discover a setting to see their options — and each is one
// tap to turn off for someone who always borrows, or always buys.
export const FIND_LINKS = ['library', 'shop']
const DEFAULT_FIND_LINKS = ['library', 'shop']

export function emptyState(){
  return {
    currentReads: [], wishlist: [], finished: [],
    library: [], bookstores: [], passed: [],
    vibe: null,
    borrowFormats: [...DEFAULT_BORROW_FORMATS],
    findLinks: [...DEFAULT_FIND_LINKS]
  }
}

// v5 → v6: borrowFormats. Absent means never chosen, so it gets the default;
// present but empty means deliberately none, and that is respected rather than
// "helpfully" reset — an empty list is a real answer and simply means no
// borrow rows.
function toBorrowFormats(data){
  if(!Array.isArray(data.borrowFormats)) return [...DEFAULT_BORROW_FORMATS]
  return data.borrowFormats.filter(f => BORROW_FORMATS.includes(f))
}

// v7 → v8: findLinks. Absent versus empty reads the same way as
// toBorrowFormats above.
function toFindLinks(data){
  if(!Array.isArray(data.findLinks)) return [...DEFAULT_FIND_LINKS]
  return data.findLinks.filter(f => FIND_LINKS.includes(f))
}

// v1 → v2: `current` (a single book or null) becomes `currentReads` (an array).
// Phase 4 renders all of them; running this on already-migrated data is a no-op,
// and it stays here forever because a document written by v1 is still a document
// someone might sign in with.
function toCurrentReads(data){
  if(Array.isArray(data.currentReads)) return data.currentReads.filter(Boolean)
  if(data.current) return [data.current]
  return []
}

// v2 → v3: bookstores. Older data simply defaults to an empty list.

// v4 → v5: books may now carry workKey, coverId, year, source, seriesKey,
// seriesName, seriesPosition and format, and a finished entry may carry
// setDown. There is nothing to convert: every one of those is optional, and a
// book without them is a book that was typed by hand, which stays a first-class
// way to add one. Entries pass through untouched — deliberately, since the
// record also holds legacy `notes` and `rating` fields that the Finished list
// still renders.
//
// v8 → v9: Phase 7 adds three more optional fields to a book — seriesTotal,
// seriesVolumes and seriesDetached — and again there is nothing to convert. That
// is the whole design: a series is a normal book carrying series fields, and
// the one-row-per-series rendering happens at paint time off seriesKey. No
// array of books is ever persisted, so a document written before series existed
// is understood by this build, and a document written by this build is
// understood by a build that predates it — it just won't group.

// Normalise any stored or remote payload into the shape the store guarantees.
// Unknown keys are dropped; missing keys get empty defaults.
export function migrate(data){
  data = data || {}
  return {
    currentReads: toCurrentReads(data),
    wishlist: Array.isArray(data.wishlist) ? data.wishlist : [],
    finished: Array.isArray(data.finished) ? data.finished : [],
    library: Array.isArray(data.library) ? data.library : [],
    bookstores: Array.isArray(data.bookstores) ? data.bookstores : [],
    // v6 → v7: books you passed on when the recommender offered them, so a
    // second ask returns genuinely different books. Nothing to convert.
    passed: Array.isArray(data.passed) ? data.passed : [],
    // Validated where it's used, not here: an unknown id falls back to the
    // default vibe rather than being silently dropped from storage.
    vibe: typeof data.vibe === 'string' && data.vibe ? data.vibe : null,
    borrowFormats: toBorrowFormats(data),
    findLinks: toFindLinks(data)
  }
}

// What we actually persist.
//
// Until Phase 4 this also wrote a legacy `current` field mirroring
// currentReads[0], so a device still running v14 could round-trip the document
// without wiping the newer field. That mirror is gone: with three current reads
// it could only ever describe one of them, and a client old enough to need it
// would write the other two away on its next save. toCurrentReads() still reads
// `current` on the way in, so an old document is understood — it just isn't
// written back.
export function toStorage(state){
  return {
    currentReads: state.currentReads,
    wishlist: state.wishlist,
    finished: state.finished,
    library: state.library,
    bookstores: state.bookstores,
    passed: state.passed,
    vibe: state.vibe,
    borrowFormats: state.borrowFormats,
    findLinks: state.findLinks
  }
}

// Whether a payload holds anything at all. This decides whether a remote
// snapshot is real enough to replace what's on this device, so it must only
// ever count actual content. `vibe`, `borrowFormats` and `findLinks` are
// preferences and are deliberately NOT counted — a document holding nothing but
// "I read ebooks" must never look real enough to overwrite an unsynced shelf.
//
// `passed` is not counted either, and that is a deliberate trade: a remote doc
// holding only pass history can be overwritten by an empty local shelf. Losing
// "don't suggest these again" is a small loss; letting it stand in for a real
// shelf and block a sync is a large one.
export function isEmptyState(s){
  if(!s) return true
  const migrated = migrate(s)
  return !migrated.currentReads.length
    && !migrated.wishlist.length
    && !migrated.finished.length
    && !migrated.library.length
    && !migrated.bookstores.length
}
