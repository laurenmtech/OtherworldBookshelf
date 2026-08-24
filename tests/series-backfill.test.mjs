// The books that were on the shelf before their series was.
//
// due() is the whole judgement of services/series-backfill.js — which books are
// worth putting to the Worker — and the one rule that matters most is the one
// that STOPS it asking: a "standalone" answer leaves no mark on the book, so
// without the stamp this would ask about every book on the shelf on every load
// forever. These tests are that rule.
import { suite, test, is, ok } from './harness.mjs'
import {
  due, RE_ASK_MS, MAX_PER_RUN, COOLDOWN_MS, runSeriesBackfill
} from '../js/services/series-backfill.js'

// Same shim as backfill.test.mjs: the store writes through to localStorage,
// which doesn't exist in node, and a suite that prints a stack on every passing
// commit is a suite people stop reading.
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
const { applyRemote, applySeries, getState } = await import('../js/state/store.js')

suite('series: asking for the books that missed')

const NOW = Date.parse('2026-08-24T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()

const S = (o = {}) => ({ currentReads: [], wishlist: [], finished: [], ...o })
const titles = (list) => list.map(b => b.title).join(', ')

const NINTH = { title: 'Ninth House', author: 'Leigh Bardugo' }

test('a book with no series is asked about', () =>
  is(titles(due(S({ finished: [NINTH] }), NOW)), 'Ninth House'))

test('every list is swept', () =>
  is(due(S({
    currentReads: [{ title: 'A' }], wishlist: [{ title: 'B' }], finished: [{ title: 'C' }]
  }), NOW).length, 3))

test('a book that already knows its series is left alone', () =>
  is(due(S({ finished: [{ ...NINTH, seriesKey: 'alex-stern' }] }), NOW).length, 0))

// The reader said stop. Asking again would be the app arguing with them.
test('a detached series is left alone', () =>
  is(due(S({ finished: [{ ...NINTH, seriesDetached: true }] }), NOW).length, 0))

// The stamp is the whole point: this is what a "standalone" answer looks like
// on the book, and it has to be enough to stop the next sweep.
test('a book asked about yesterday is not asked again', () =>
  is(due(S({ finished: [{ ...NINTH, seriesAskedAt: ago(24 * 60 * 60 * 1000) }] }), NOW).length, 0))

// The Worker caches a "standalone" for thirty days precisely so a wrong "no"
// can heal. It only heals if somebody asks a second time.
test('a book asked about a month ago is asked again', () =>
  is(due(S({ finished: [{ ...NINTH, seriesAskedAt: ago(RE_ASK_MS + 1000) }] }), NOW).length, 1))

test('a nonsense stamp counts as never asked', () =>
  is(due(S({ finished: [{ ...NINTH, seriesAskedAt: 'soon' }] }), NOW).length, 1))

// A bare title the catalogue hasn't confirmed yet — quite possibly a typo.
// backfill.js calls enrich() itself the moment it resolves one.
test('a book still waiting on its details is not asked about', () =>
  is(due(S({ wishlist: [{ ...NINTH, needsDetails: true }] }), NOW).length, 0))

test('a book with no title is not asked about', () =>
  is(due(S({ finished: [{ author: 'Nobody' }] }), NOW).length, 0))

suite('series: the sweep itself')

// Nothing is asked when there is nothing to ask WITH. /series is an
// authenticated route, and in node — as on a signed-out phone — there is no
// token, so lookup() answers nothing, the sweep stops on the first book rather
// than firing the whole queue at a wall, and the rest stay in the queue.
//
// Asserted on the returned tally rather than on the shelf: this test is async,
// the ones below are not, and they share one store. Nothing was stamped either,
// which follows — the stamp only happens on an ANSWERED lookup, so an
// unreachable Worker can't cost a book thirty days of silence.
test('a sweep with no way to ask asks nothing', async () => {
  applyRemote(S({ finished: [NINTH] }))
  const r = await runSeriesBackfill()
  return is(`${r.asked}/${r.placed}/${r.waiting}`, '0/0/1')
})

test('a run is capped', () => ok(MAX_PER_RUN > 0 && MAX_PER_RUN <= 20))

// The cooldown between sweeps must not be started by a sweep that couldn't ask.
// Signing in is what makes the lookups possible, and it fires immediately after
// the boot attempt that found no token — a cooldown set by that attempt would
// lock out the one run that was always going to work.
test('a sweep that asked nothing starts no cooldown', async () => {
  applyRemote(S({ finished: [NINTH] }))
  await runSeriesBackfill()
  const again = await runSeriesBackfill()
  return is(again.paused, false)
})

test('the cooldown is long enough to matter', () => ok(COOLDOWN_MS >= 60 * 1000))

// End to end on the rule that stops the asking: an answer of "standalone"
// changes nothing about the book except that it has now been asked — and that
// is enough for the next sweep to skip it.
test('a standalone answer stamps the book', () => {
  applyRemote(S({ finished: [NINTH] }))
  applySeries('t:ninth house|leigh bardugo', null, { asked: true })
  return ok(getState().finished[0].seriesAskedAt)
})

test('and the stamped book is not asked about again', () => {
  applyRemote(S({ finished: [NINTH] }))
  applySeries('t:ninth house|leigh bardugo', null, { asked: true })
  return is(due(getState()).length, 0)
})

// A series answer still arrives on the book. The stamp is bookkeeping, not a
// replacement for the answer.
test('a series answer lands and stamps in one go', () => {
  applyRemote(S({ finished: [NINTH] }))
  applySeries('t:ninth house|leigh bardugo', {
    seriesKey: 'alex-stern', seriesName: 'Alex Stern', seriesPosition: 1, seriesTotal: 2,
    seriesVolumes: [
      { title: 'Ninth House', author: 'Leigh Bardugo', verified: true },
      { title: 'Hell Bent', author: 'Leigh Bardugo', verified: true }
    ]
  }, { asked: true })
  const book = getState().finished[0]
  return is(`${book.seriesName} #${book.seriesPosition}`, 'Alex Stern #1')
})
