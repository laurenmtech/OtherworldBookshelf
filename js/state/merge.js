// Folding an exported shelf into this one. The rule is: WHAT IS HERE WINS.
// Import can only ever ADD — see ARCHITECTURE.md > Invariants.
//
// DESCRIPTIVE below is the whitelist of fields an incoming copy may fill in.
// finishedAt, feeling, moods, setDown are deliberately absent: those are facts
// about your reading, and a file has no standing to supply them.
import { bookKey } from '../services/book-shape.js'
import { migrate } from './migrate.js'

const DESCRIPTIVE = [
  'author', 'year', 'source', 'workKey', 'coverId', 'googleId', 'coverSrc',
  'genres', 'format',
  'seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal', 'seriesVolumes'
]

function fillGaps(mine, theirs){
  let out = mine
  for(const field of DESCRIPTIVE){
    if(out[field] !== undefined) continue
    if(theirs[field] === undefined) continue
    if(out === mine) out = { ...mine }
    out[field] = theirs[field]
  }
  return out
}

const placeKey = (p) =>
  `${String(p && p.name || '').trim().toLowerCase()}|${String(p && p.url || '').trim().toLowerCase()}`

const passKey = (p) =>
  `${String(p && p.title || '').trim().toLowerCase()}|${String(p && p.author || '').trim().toLowerCase()}`

function mergeList(mine, theirs, keyOf){
  const seen = new Set(mine.map(keyOf))
  const added = []
  for(const item of theirs){
    const k = keyOf(item)
    if(!k || k === '|' || seen.has(k)) continue
    seen.add(k)
    added.push(item)
  }
  return { list: [...mine, ...added], added: added.length }
}

export function mergeShelf(state, raw){
  const incoming = migrate(raw)

  const here = new Map()
  for(const list of ['currentReads', 'wishlist', 'finished']){
    for(const book of state[list]) here.set(bookKey(book), { list, book })
  }

  const patched = { currentReads: [], wishlist: [], finished: [] }
  for(const list of ['currentReads', 'wishlist', 'finished']) patched[list] = [...state[list]]

  const theirsByKey = new Map()
  for(const list of ['currentReads', 'wishlist', 'finished']){
    for(const book of incoming[list]){
      const k = bookKey(book)
      if(k && !theirsByKey.has(k)) theirsByKey.set(k, book)
    }
  }
  for(const list of ['currentReads', 'wishlist', 'finished']){
    patched[list] = patched[list].map(book => {
      const theirs = theirsByKey.get(bookKey(book))
      return theirs ? fillGaps(book, theirs) : book
    })
  }

  const added = { currentReads: 0, wishlist: 0, finished: 0, library: 0, bookstores: 0 }
  const taken = new Set(here.keys())
  const fresh = { currentReads: [], wishlist: [], finished: [] }
  for(const list of ['finished', 'currentReads', 'wishlist']){
    for(const book of incoming[list]){
      if(!book || !String(book.title || '').trim()) continue
      const k = bookKey(book)
      if(!k || taken.has(k)) continue
      taken.add(k)
      fresh[list].push(book)
      added[list]++
    }
  }

  const room = Math.max(0, 3 - patched.currentReads.length)
  const promoted = fresh.currentReads.slice(0, room)
  const overflow = fresh.currentReads.slice(room)
  added.currentReads = promoted.length
  added.wishlist += overflow.length

  const library = mergeList(state.library, incoming.library, placeKey)
  const bookstores = mergeList(state.bookstores, incoming.bookstores, placeKey)
  const passed = mergeList(state.passed, incoming.passed, passKey)
  added.library = library.added
  added.bookstores = bookstores.added

  return {
    next: {
      ...state,
      currentReads: [...patched.currentReads, ...promoted],
      wishlist: [...patched.wishlist, ...fresh.wishlist, ...overflow],
      finished: [...fresh.finished, ...patched.finished],
      library: library.list,
      bookstores: bookstores.list,
      passed: passed.list
    },
    added
  }
}
