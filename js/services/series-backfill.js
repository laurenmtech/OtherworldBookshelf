// The books that were on the shelf before their series was.
//
// A series is asked for ONCE, at add time (ARCHITECTURE.md > Series), and until
// this file existed that was the only moment it was ever asked. Everything
// added before Phase 7 shipped, and everything whose one lookup happened to
// land on a dead network, an expired token or a Worker having a bad minute, sat
// there as a standalone forever — no "Book 1 of 2" on the row, and nothing
// offered when it was finished. A reader finished Ninth House and the app said
// nothing, because nothing had ever asked.
//
// So: the same shape as backfill.js, for a different blank. Walk the shelf,
// find the books that have never been asked, ask about them, and stop asking.
//
// FOUR THINGS KEEP THIS QUIET:
//
//   1. IT STAMPS EVERY ANSWER, including "standalone". A standalone answer
//      leaves no mark on the book — that is the whole point of it — so without
//      `seriesAskedAt` the sweep would re-ask every book on every load until
//      the end of time. See applySeries() in state/store.js.
//   2. IT ASKS AGAIN AFTER THIRTY DAYS, and not before. The Worker caches a
//      "standalone" for exactly that long, on the grounds that an author may
//      yet write a sequel and a wrong "no" should be able to heal — which it
//      can only do if somebody asks a second time. Ninth House IS that case.
//   3. IT STOPS ON THE FIRST UNANSWERED LOOKUP. Offline, signed out, Worker
//      down: the rest of the queue keeps its blank and waits for the next visit
//      rather than firing a burst of requests that will all fail the same way.
//   4. IT ASKS FOR A FEW BOOKS AT A TIME. A long shelf finishes over several
//      visits. Nobody is waiting on this.
//
// It costs almost nothing to be wrong about: fanOut() in the Worker caches a
// verified series under every volume it names, so the answers are mostly cache
// hits that never reach the model, and reclaimSeries() places the siblings of
// anything this does find without asking about them at all.
import { lookup } from './series.js'
import { bookKey, findExisting, inSeries, SERIES } from './book-shape.js'
import { getState, applySeries } from '../state/store.js'
import { onAuthChange } from '../state/auth.js'

const LISTS = ['currentReads', 'wishlist', 'finished']

// The Worker's SOFT_TTL for a "standalone" answer (api/src/series.js). Asking
// sooner would only re-read its cache; asking later would leave a wrong "no"
// standing longer than the Worker itself believes it.
export const RE_ASK_MS = 30 * 24 * 60 * 60 * 1000

// Per run, not per day. The cap that matters is the Worker's, and this is here
// so a first load on a hundred-book shelf isn't a hundred requests.
export const MAX_PER_RUN = 8

// Between runs. `visibilitychange` fires every time the tab comes forward, and
// without this a morning of switching apps would be burst after burst of
// lookups — against a ceiling that ADDING A BOOK also draws on. Nothing here is
// urgent; a long shelf can take an afternoon.
export const COOLDOWN_MS = 10 * 60 * 1000

// After the Worker says no more today. SERIES_DAILY_CAP is an abuse ceiling,
// never surfaced to anyone, and it exists for the lookups a reader ASKS for by
// adding a book. A background sweep that spends it would be this feature
// breaking the one it was written to fix, so a 429 stands it down.
export const QUOTA_PAUSE_MS = 60 * 60 * 1000

// Only ever moved forward by a run that actually asked something. A sweep that
// found no token — signed out, or auth not resolved yet — did nothing and must
// not lock out the sign-in that is about to make it possible.
let nextRunAt = 0

// Has this book been put to the Worker recently enough to leave alone?
//
// Exported because the finish modal asks the same question at the one moment it
// matters most — see components/modals/finish-modal.js. Both callers have to
// agree, or opening the modal would re-ask about every standalone on the shelf.
export function needsAsking(book, now = Date.now()){
  if(!book || !book.title) return false
  if(book.needsDetails) return false
  if(book.seriesKey || book.seriesDetached) return false
  const at = Date.parse(book.seriesAskedAt)
  if(Number.isNaN(at)) return true
  return now - at >= RE_ASK_MS
}

// Exported for the tests: which books are worth a lookup is the whole of this
// module's judgement, and it should be checkable without a network.
//
// `needsDetails` is deliberately skipped. That book is a bare title that the
// catalogue has not confirmed yet — quite possibly a typo — and backfill.js
// calls enrich() itself the moment it resolves one. Asking here as well would
// be asking about a title nobody has verified.
export function due(state, now = Date.now()){
  const out = []
  for(const list of LISTS){
    for(const book of (state && state[list]) || []){
      if(needsAsking(book, now)) out.push(book)
    }
  }
  return out
}

let running = false

// Returns what it did, for the tests and for anyone debugging a book that
// stayed a standalone. Never throws: this runs unattended, and its failure mode
// is simply that the shelf looks exactly as it did before.
export async function runSeriesBackfill(now = Date.now()){
  // `status` is the Worker's answer to the last refusal, or null when the
  // lookup never got that far — no token, no network. Nothing renders it: it is
  // here so that `runSeriesBackfill().then(console.log)` in a browser console
  // says WHY a shelf stayed silent, in a feature whose whole design is to fail
  // without saying anything.
  const result = { asked: 0, placed: 0, waiting: 0, paused: false, status: null }
  if(!SERIES) return result
  if(running) return result
  if(now < nextRunAt){
    result.paused = true
    return result
  }
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return result

  const queue = due(getState(), now).slice(0, MAX_PER_RUN)
  if(!queue.length) return result

  running = true
  try{
    for(const book of queue){
      const key = bookKey(book)
      // The shelf can change under a run, and one answer can place several
      // books: applySeries() hands its list to reclaimSeries(), which may have
      // given this very book its series while we were waiting on the last
      // request. Asking anyway would spend a lookup to be told what the shelf
      // already knows.
      const found = findExisting(getState(), book)
      if(!found || inSeries(found.entry)) continue

      const { answered, series, status } = await lookup(book)
      if(!answered){
        result.waiting = queue.length - result.asked
        result.status = status === undefined ? null : status
        // Out of lookups for today. Standing down for an hour leaves the
        // ceiling to the reader, who spends it by adding a book and expects an
        // answer while the finish modal is still open.
        if(status === 429){
          nextRunAt = now + QUOTA_PAUSE_MS
          result.paused = true
        }
        break
      }
      applySeries(key, series, { asked: true })
      result.asked++
      if(series) result.placed++
    }
  }finally{
    running = false
  }
  if(result.asked) nextRunAt = now + COOLDOWN_MS
  return result
}

// The two signals backfill.js watches, plus one it doesn't need: SIGNING IN.
//
// /series is an authenticated route, so a sweep that ran at boot would find no
// token yet, stop on the first unanswered lookup and — on a tab that is already
// visible and already online — have nothing left to wake it until the next app
// open. Auth resolving IS the moment this becomes possible, and it fires on
// every load for a reader who is already signed in.
//
// With nothing due, all three cost a walk of the shelf and no requests.
export function watchForSeries(){
  const run = () => { runSeriesBackfill() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', () => { if(!document.hidden) run() })
  onAuthChange((user) => { if(user) run() })
}
