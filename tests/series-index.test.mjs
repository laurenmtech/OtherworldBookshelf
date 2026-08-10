// Placing a book from a list a sibling already holds.
//
// The shape being tested is the one that reached a real shelf: seven Throne of
// Glass books, four grouped, three drawn as standalones underneath because
// their own lookups came back empty. See js/services/series-index.js.
import { suite, test, is, ok } from './harness.mjs'
import { seriesIndex, placeIn, reclaimSeries } from '../js/services/series-index.js'

suite('series: placing a book from a sibling\'s list')

const TOG = [
  'Throne of Glass', 'Crown of Midnight', 'Heir of Fire', 'Queen of Shadows',
  'Empire of Storms', 'Tower of Dawn', 'Kingdom of Ash'
]

// What the Worker stores on a book whose lookup worked.
const volumes = (titles = TOG, { verified = true } = {}) =>
  titles.map(t => ({ title: t, author: 'Sarah J. Maas', verified }))

const placed = (title, extra = {}) => ({
  title, author: 'Sarah J. Maas',
  seriesKey: 'throne-of-glass', seriesName: 'Throne of Glass',
  seriesPosition: TOG.indexOf(title) + 1, seriesTotal: TOG.length,
  seriesVolumes: volumes(), ...extra
})

// The failure: no seriesKey at all, because shape() threw the answer away.
const loose = (title, extra = {}) => ({ title, author: 'Sarah J. Maas', ...extra })

const shelf = (finished, rest = {}) =>
  ({ currentReads: [], wishlist: [], finished, ...rest })

// ── The index ───────────────────────────────────────────────────────────────

test('a series the shelf can speak for is indexed', () =>
  is(seriesIndex([[placed('Queen of Shadows')]]).size, 1))

test('a book with no volume list cannot speak for its series', () =>
  is(seriesIndex([[{ ...placed('Queen of Shadows'), seriesVolumes: undefined }]]).size, 0))

test('a detached volume does not speak for its series', () =>
  is(seriesIndex([[placed('Queen of Shadows', { seriesDetached: true })]]).size, 0))

// A lookup that dropped Tower of Dawn as a "companion volume" returns six.
test('the longest list wins', () => {
  const short = { ...placed('Kingdom of Ash'), seriesVolumes: volumes(TOG.filter(t => t !== 'Tower of Dawn')) }
  const index = seriesIndex([[short, placed('Queen of Shadows')]])
  return is(index.get('throne-of-glass').seriesVolumes.length, 7)
})

test('the longest list wins regardless of order', () => {
  const short = { ...placed('Kingdom of Ash'), seriesVolumes: volumes(TOG.filter(t => t !== 'Tower of Dawn')) }
  const index = seriesIndex([[placed('Queen of Shadows'), short]])
  return is(index.get('throne-of-glass').seriesVolumes.length, 7)
})

// ── Placing one book ────────────────────────────────────────────────────────

const index = seriesIndex([[placed('Queen of Shadows')]])

test('a loose volume is placed', () =>
  is(placeIn(index, loose('Heir of Fire')).seriesKey, 'throne-of-glass'))

test('it is placed at the right position', () =>
  is(placeIn(index, loose('Tower of Dawn')).seriesPosition, 6))

test('it carries the list forward, so it can advance', () =>
  is(placeIn(index, loose('Kingdom of Ash')).seriesVolumes.length, 7))

test('a catalogue subtitle still matches', () =>
  is(placeIn(index, loose('Heir of Fire (Throne of Glass #3)')).seriesPosition, 3))

test('a book already in a series is left alone', () =>
  is(placeIn(index, placed('Heir of Fire')), null))

test('a detached book stays detached', () =>
  is(placeIn(index, { ...loose('Heir of Fire'), seriesDetached: true }), null))

test('a book that is not in the list is left alone', () =>
  is(placeIn(index, loose('Piranesi')), null))

// The two anti-invention rules.
test('an unverified volume cannot claim a book', () => {
  const unchecked = seriesIndex([[{ ...placed('Queen of Shadows'), seriesVolumes: volumes(TOG, { verified: false }) }]])
  return is(placeIn(unchecked, loose('Heir of Fire')), null)
})

test('a different author is not swallowed', () =>
  is(placeIn(index, { title: 'Heir of Fire', author: 'Robin Hobb' }), null))

test('a partial author still agrees', () =>
  ok(placeIn(index, { title: 'Heir of Fire', author: 'Maas' })))

test('a book with no author is not contradicted', () =>
  ok(placeIn(index, { title: 'Heir of Fire' })))

// ── Across the shelf ────────────────────────────────────────────────────────

// The reported bug, end to end.
test('the three loose volumes rejoin the four grouped ones', () => {
  const before = shelf([
    placed('Throne of Glass'), placed('Crown of Midnight'),
    placed('Queen of Shadows'), placed('Empire of Storms'),
    loose('Heir of Fire'), loose('Tower of Dawn'), loose('Kingdom of Ash')
  ])
  const after = reclaimSeries(before)
  return is(after.finished.filter(b => b.seriesKey === 'throne-of-glass').length, 7)
})

test('a list speaks for the other lists too', () => {
  const after = reclaimSeries({
    currentReads: [loose('Kingdom of Ash')],
    wishlist: [loose('Tower of Dawn')],
    finished: [placed('Queen of Shadows')]
  })
  return is(after.currentReads[0].seriesPosition, 7) && is(after.wishlist[0].seriesPosition, 6)
})

test('an unrelated book is untouched', () => {
  const after = reclaimSeries(shelf([placed('Queen of Shadows'), loose('Piranesi')]))
  return is(after.finished[1].seriesKey, undefined)
})

// This is what keeps applyRemote() from treating every snapshot as news.
test('nothing to place returns the same object', () => {
  const before = shelf([placed('Queen of Shadows'), loose('Piranesi')])
  return is(reclaimSeries(before), before)
})

test('a shelf with no series at all returns the same object', () => {
  const before = shelf([loose('Piranesi')])
  return is(reclaimSeries(before), before)
})

test('running twice changes nothing the second time', () => {
  const once = reclaimSeries(shelf([placed('Queen of Shadows'), loose('Heir of Fire')]))
  return is(reclaimSeries(once), once)
})

test('an empty shelf is survivable', () =>
  ok(reclaimSeries({ currentReads: [], wishlist: [], finished: [] })))
