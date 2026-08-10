// Phase 7: the record renders a series as one row, at paint time, off seriesKey.
// The store indexes each entry carries must survive that — removeFinished()
// takes a position in state.finished, so grouping losing one would delete the
// wrong book.
import { suite, test, is, ok } from './harness.mjs'
import { toRows, byRowNewest } from '../js/components/finished-list.js'
import { reclaimSeries } from '../js/services/series-index.js'

suite('record: grouping')

const vol = (pos, date) => ({
  title: `Vol ${pos}`, seriesKey: 'tog', seriesName: 'Throne of Glass',
  seriesPosition: pos, finishedAt: date
})
const solo = (t, date) => ({ title: t, finishedAt: date })
const E = (arr) => arr.map((item, index) => ({ item, index }))

test('one row per series, plus one per book', () =>
  is(toRows(E([vol(1, '2026-01-04'), solo('Piranesi', '2026-02-02'), vol(3, '2026-03-12')])).length, 2))

test('the series row holds both volumes', () => {
  const rows = toRows(E([vol(1, '2026-01-04'), solo('P', '2026-02-02'), vol(3, '2026-03-12')]))
  return is(rows.find(r => r.kind === 'series').entries.length, 2)
})

// A disclosure that hides nothing is a control you must open to learn there was
// nothing to see.
test('a single volume is not collapsed into a series row', () =>
  ok(toRows(E([vol(1, '2026-01-04'), solo('Piranesi', '2026-02-02')])).every(r => r.kind === 'book')))

test('a detached volume leaves the group', () => {
  const rows = toRows(E([vol(1, '2026-01-04'), { ...vol(2, '2026-02-02'), seriesDetached: true }, vol(3, '2026-03-01')]))
  return is(rows.length, 2) && is(rows.find(r => r.kind === 'series').entries.length, 2)
})

test('store indexes survive grouping', () => {
  const rows = toRows(E([vol(1, '2026-01-04'), solo('P', '2026-02-02'), vol(3, '2026-03-12')]))
  return is(rows.find(r => r.kind === 'series').entries.map(e => e.index).join(), '0,2')
})

// A series returns to the top of the record each time a volume joins it.
test('a series sorts by its most recent volume', () => {
  const rows = toRows(E([vol(1, '2026-01-04'), solo('Piranesi', '2026-02-02'), vol(3, '2026-03-12')]))
  rows.sort(byRowNewest)
  return is(rows[0].kind, 'series')
})

test('undated entries sink to the bottom', () => {
  const rows = toRows(E([solo('Old', undefined), solo('New', '2026-03-12')]))
  rows.sort(byRowNewest)
  return is(rows[0].entry.item.title, 'New')
})

// The reported bug, at the layer it was seen: four Throne of Glass volumes in a
// group and three drawn as standalones beneath it, because each book's own
// lookup had to succeed for it to be grouped. reclaimSeries() places the three
// from the list the other four are already holding; toRows() then sees one
// series. See js/services/series-index.js.
const TOG = ['Throne of Glass', 'Crown of Midnight', 'Heir of Fire', 'Queen of Shadows',
             'Empire of Storms', 'Tower of Dawn', 'Kingdom of Ash']

const knows = (title) => ({
  title, author: 'Sarah J. Maas', finishedAt: '2026-02-01',
  seriesKey: 'tog', seriesName: 'Throne of Glass',
  seriesPosition: TOG.indexOf(title) + 1, seriesTotal: TOG.length,
  seriesVolumes: TOG.map(t => ({ title: t, author: 'Sarah J. Maas', verified: true }))
})
const missed = (title) => ({ title, author: 'Sarah J. Maas', finishedAt: '2026-02-01' })

const reported = [
  knows('Throne of Glass'), knows('Crown of Midnight'),
  knows('Queen of Shadows'), knows('Empire of Storms'),
  missed('Heir of Fire'), missed('Tower of Dawn'), missed('Kingdom of Ash')
]

test('without reclaiming, three volumes draw as standalones', () =>
  is(toRows(E(reported)).filter(r => r.kind === 'book').length, 3))

test('after reclaiming, the shelf draws one series', () => {
  const rows = toRows(E(reclaimSeries({ currentReads: [], wishlist: [], finished: reported }).finished))
  return is(rows.length, 1) && is(rows[0].kind, 'series') && is(rows[0].entries.length, 7)
})

test('the reclaimed volumes sort into publication order', () => {
  const rows = toRows(E(reclaimSeries({ currentReads: [], wishlist: [], finished: reported }).finished))
  return is(rows[0].entries.map(e => e.item.seriesPosition).sort((a, b) => a - b).join(), '1,2,3,4,5,6,7')
})
