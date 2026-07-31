// Phase 7: the record renders a series as one row, at paint time, off seriesKey.
// The store indexes each entry carries must survive that — removeFinished()
// takes a position in state.finished, so grouping losing one would delete the
// wrong book.
import { suite, test, is, ok } from './harness.mjs'
import { toRows, byRowNewest } from '../js/components/finished-list.js'

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
