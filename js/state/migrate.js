// Forward migrations. Every one must be safe to run twice — this runs on every
// load, on local data and on each remote snapshot.

export const SHAPE_VERSION = 3

export function emptyState(){
  return {
    currentReads: [], wishlist: [], finished: [],
    library: [], bookstores: []
  }
}

// v1 → v2: `current` (a single book or null) becomes `currentReads` (an array).
// The UI still renders only the first entry in this phase; the list arrives in
// Phase 3. Running this on already-migrated data is a no-op.
function toCurrentReads(data){
  if(Array.isArray(data.currentReads)) return data.currentReads.filter(Boolean)
  if(data.current) return [data.current]
  return []
}

// v2 → v3: bookstores. Older data simply defaults to an empty list — nothing to
// convert, which is why this is safe to run against every snapshot forever.

// Normalise any stored or remote payload into the shape the store guarantees.
// Unknown keys are dropped; missing keys get empty defaults.
export function migrate(data){
  data = data || {}
  return {
    currentReads: toCurrentReads(data),
    wishlist: Array.isArray(data.wishlist) ? data.wishlist : [],
    finished: Array.isArray(data.finished) ? data.finished : [],
    library: Array.isArray(data.library) ? data.library : [],
    bookstores: Array.isArray(data.bookstores) ? data.bookstores : []
  }
}

// What we actually persist. `current` is written alongside `currentReads` as a
// mirror of the first entry so a device still running the previous release can
// read — and round-trip — this document without losing the current book.
// Remove this mirror in Phase 4, once no old clients remain.
export function toStorage(state){
  return {
    currentReads: state.currentReads,
    current: state.currentReads[0] || null,
    wishlist: state.wishlist,
    finished: state.finished,
    library: state.library,
    bookstores: state.bookstores
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
