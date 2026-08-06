// A hard refresh used to flash: several Firestore snapshots landed per load and
// each one committed, and every commit rebuilt every list and replayed the
// entrance animation on every row. Both guards below are what stopped it, and
// both are the kind of thing a later change would quietly undo.
//
// The rule they must not break: a redraw is skipped only when skipping it can't
// strand a captured index — see "The index invariant" in ARCHITECTURE.md.
import { suite, test, is, ok } from './harness.mjs'
import { entranceGuard } from '../js/ui/entrance.js'
import { applyRemote, subscribe, getState } from '../js/state/store.js'

suite('redraws that are not news')

test('the first render is always news', () =>
  ok(entranceGuard()(['a', 'b'])))

test('the same books again are not', () => {
  const isNews = entranceGuard()
  isNews(['a', 'b'])
  return is(isNews(['a', 'b']), false)
})

test('a book arriving is news', () => {
  const isNews = entranceGuard()
  isNews(['a', 'b'])
  return ok(isNews(['a', 'b', 'c']))
})

// Current Reads is ordered on purpose, so a reorder is a different list.
test('the same books in a new order are news', () => {
  const isNews = entranceGuard()
  isNews(['a', 'b'])
  return ok(isNews(['b', 'a']))
})

// Keys hold titles and authors, so a separator a key could contain would let two
// different piles collide and a new row would arrive without its entrance.
test('a separator cannot be forged out of the keys', () => {
  const isNews = entranceGuard()
  isNews(['a b', 'c'])
  return ok(isNews(['a', 'b c']))
})

const shelf = () => ({ wishlist: [{ title: 'Piranesi', author: 'Susanna Clarke' }] })

// The store is one module-level shelf, so each of these starts from a known
// state rather than from whatever ran before it.
test('a snapshot that changes nothing does not notify', () => {
  applyRemote({ wishlist: [] })
  let commits = 0
  const off = subscribe(() => commits++)
  applyRemote(shelf())
  applyRemote(shelf())        // a different object, the same shelf
  off()
  return is(commits, 1)
})

test('a snapshot that changes something still does', () => {
  applyRemote(shelf())
  let commits = 0
  const off = subscribe(() => commits++)
  const more = shelf()
  more.wishlist.push({ title: 'Jonathan Strange', author: 'Susanna Clarke' })
  applyRemote(more)
  off()
  is(commits, 1)
  return is(getState().wishlist.length, 2)
})
