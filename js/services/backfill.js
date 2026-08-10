// The other half of adding a book with no signal.
//
// The search deliberately fails offline (see ARCHITECTURE.md > Search), so a book
// added at a bar with one bar of reception arrives as a bare title and an author,
// carrying `needsDetails`. This is what the typeahead means when it says the book
// will sync later: when the network comes back, ask the catalogue what it was and
// fill in the blanks.
//
// STRICT ON PURPOSE, because nobody is watching when this runs. A wrong cover and a
// wrong genre arriving silently, days later, would be believed — and this app's rule
// everywhere else is that it never invents (see nextVolume() and the verified-volume
// check). So a result is only accepted when its title matches what was typed and its
// author doesn't contradict it, and when it is the ONLY such result. Anything less
// certain waits for the reader to name it by hand.
import { searchBooks } from './books.js'
import { bookKey } from './book-shape.js'
import { enrich } from './series.js'
import { getState, applyDetails, noteDetailsMiss } from '../state/store.js'

// A book the catalogue cannot confirm — a typo, or something too obscure to be in
// it — must not re-search on every app open for the rest of time.
export const MAX_TRIES = 3

export function pending(state){
  const out = []
  for(const list of ['currentReads', 'wishlist', 'finished']){
    for(const book of (state && state[list]) || []){
      if(book && book.needsDetails && book.title) out.push(book)
    }
  }
  return out
}

function norm(s){
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// "Tolkien" has to match "J. R. R. Tolkien", so this is containment rather than
// equality — but by WHOLE WORD, or "King" would match Barbara Kingsolver.
function authorAgrees(typed, found){
  const want = norm(typed)
  if(!want) return true                     // nothing typed that a result could contradict
  const have = new Set(norm(found).split(' ').filter(Boolean))
  return want.split(' ').filter(Boolean).every(w => have.has(w))
}

// Exported for the tests: this is the whole safety argument, and it should be
// checkable without a network.
export function strictMatch(typed, results){
  const title = norm(typed && typed.title)
  if(!title) return null
  const hits = (results || []).filter(r =>
    r && norm(r.title) === title && authorAgrees(typed.author, r.author))
  // Two books with the same title is exactly the case a guess gets wrong, and
  // "Babel" is not a rare shape. Ambiguity is a refusal, not a coin toss.
  return hits.length === 1 ? hits[0] : null
}

async function resolve(book){
  // Searching title AND author is what makes the ranking find a modest book at
  // all — see ranked() in books.js, where the author half is load-bearing.
  const query = [book.title, book.author].filter(Boolean).join(' ')
  return strictMatch(book, await searchBooks(query))
}

let running = false

// Returns what it did, for the tests and for anyone debugging a shelf that
// didn't fill in. Never throws: this runs unattended and its failure mode is
// simply that the books keep waiting.
export async function runBackfill(){
  const result = { filled: 0, gaveUp: 0, waiting: 0 }
  if(running) return result
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return result

  const queue = pending(getState())
  if(!queue.length) return result

  running = true
  try{
    for(const book of queue){
      if(typeof navigator !== 'undefined' && navigator.onLine === false) break
      // Books are re-found by key at patch time — the shelf can change while this
      // runs, and a stale position would patch the wrong book.
      const key = bookKey(book)
      let match = null
      try{
        match = await resolve(book)
      }catch(err){
        // The network went away again mid-run. The rest of the queue keeps its
        // flag and its try count, and waits for the next time we come back.
        result.waiting = queue.length - (result.filled + result.gaveUp)
        break
      }
      if(match){
        if(applyDetails(key, match)) result.filled++
        // The series lookup was skipped at add time for the same reason the search
        // was. Now that the catalogue has confirmed the book, ask.
        enrich({ title: book.title, author: match.author || book.author })
      }else if(noteDetailsMiss(key, MAX_TRIES)){
        result.gaveUp++
      }
    }
  }finally{
    running = false
  }
  return result
}

// `online` alone is not enough on a phone. navigator.onLine only knows whether
// there is an interface, not whether it reaches anything, and coming back from a
// dead zone often doesn't fire it at all — but returning to the app always shows
// the tab. Both are cheap: with nothing pending this costs zero requests.
export function watchForNetwork(){
  const run = () => { runBackfill() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => { if(!document.hidden) run() })
  run()
}
