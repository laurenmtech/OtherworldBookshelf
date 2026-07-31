// Forward migrations. Every one must be safe to run twice — this runs on every
// load and on every remote snapshot.
//
// There is deliberately no version number: each function reads the shape it finds.
// Entries pass through UNTOUCHED, so legacy `notes` and `rating` survive.
export const BORROW_FORMATS = ['ebook', 'audiobook']
const DEFAULT_BORROW_FORMATS = ['ebook']

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

function toBorrowFormats(data){
  if(!Array.isArray(data.borrowFormats)) return [...DEFAULT_BORROW_FORMATS]
  return data.borrowFormats.filter(f => BORROW_FORMATS.includes(f))
}

function toFindLinks(data){
  if(!Array.isArray(data.findLinks)) return [...DEFAULT_FIND_LINKS]
  return data.findLinks.filter(f => FIND_LINKS.includes(f))
}

function toCurrentReads(data){
  if(Array.isArray(data.currentReads)) return data.currentReads.filter(Boolean)
  if(data.current) return [data.current]
  return []
}

export function migrate(data){
  data = data || {}
  return {
    currentReads: toCurrentReads(data),
    wishlist: Array.isArray(data.wishlist) ? data.wishlist : [],
    finished: Array.isArray(data.finished) ? data.finished : [],
    library: Array.isArray(data.library) ? data.library : [],
    bookstores: Array.isArray(data.bookstores) ? data.bookstores : [],
    passed: Array.isArray(data.passed) ? data.passed : [],
    vibe: typeof data.vibe === 'string' && data.vibe ? data.vibe : null,
    borrowFormats: toBorrowFormats(data),
    findLinks: toFindLinks(data)
  }
}

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

export function isEmptyState(s){
  if(!s) return true
  const migrated = migrate(s)
  return !migrated.currentReads.length
    && !migrated.wishlist.length
    && !migrated.finished.length
    && !migrated.library.length
    && !migrated.bookstores.length
}
