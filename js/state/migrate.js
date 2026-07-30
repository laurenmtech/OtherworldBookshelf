// Forward migrations. Every one must be safe to run twice — this runs on every
// load, on local data and on each remote snapshot.

export const SHAPE_VERSION = 5

export function emptyState(){
  return {
    currentReads: [], wishlist: [], finished: [],
    library: [], bookstores: [],
    vibe: null
  }
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

// v2 → v3: bookstores. Older data simply defaults to an empty list — nothing to
// convert, which is why this is safe to run against every snapshot forever.

// v4 → v5: books may now carry workKey, coverId, year, source, seriesKey,
// seriesName, seriesPosition and format, and a finished entry may carry
// setDown. There is nothing to convert: every one of those is optional, and a
// book without them is a book that was typed by hand, which stays a first-class
// way to add one. Entries pass through untouched — deliberately, since the
// record also holds legacy `notes` and `rating` fields that the Finished list
// still renders.

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
    // Validated where it's used, not here: an unknown id falls back to the
    // default vibe rather than being silently dropped from storage.
    vibe: typeof data.vibe === 'string' && data.vibe ? data.vibe : null
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
    vibe: state.vibe
  }
}

// Whether a payload holds anything at all. This decides whether a remote
// snapshot is real enough to replace what's on this device, so it must only
// ever count actual content — if a preference were ever added to the state,
// it does not belong in here.
export function isEmptyState(s){
  if(!s) return true
  const migrated = migrate(s)
  return !migrated.currentReads.length
    && !migrated.wishlist.length
    && !migrated.finished.length
    && !migrated.library.length
    && !migrated.bookstores.length
}
