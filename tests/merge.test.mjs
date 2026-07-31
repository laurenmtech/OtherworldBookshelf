// Phase 8: importing a shelf. The rule is "what is here wins", and the property
// that matters most is that import can only ever ADD — it syncs, so a merge
// that could delete would delete on every device.
import { suite, test, is, ok } from './harness.mjs'
import { mergeShelf } from '../js/state/merge.js'

suite('import: merging a shelf')

const S = (o = {}) => ({
  currentReads: [], wishlist: [], finished: [], library: [], bookstores: [],
  passed: [], vibe: 'cottage', borrowFormats: ['ebook'], findLinks: ['library'], ...o
})

const mine = { title: 'Piranesi', author: 'Clarke', feeling: 'loved', finishedAt: '2026-02-02' }
const theirs = { title: 'Piranesi', author: 'Clarke', feeling: 'fine', finishedAt: '2026-01-09', coverId: 42 }

test('my feeling survives a clash', () =>
  is(mergeShelf(S({ finished: [mine] }), { finished: [theirs] }).next.finished[0].feeling, 'loved'))
test('my date survives a clash', () =>
  is(mergeShelf(S({ finished: [mine] }), { finished: [theirs] }).next.finished[0].finishedAt, '2026-02-02'))
test('their cover fills my gap', () =>
  is(mergeShelf(S({ finished: [mine] }), { finished: [theirs] }).next.finished[0].coverId, 42))
test('no duplicate row', () =>
  is(mergeShelf(S({ finished: [mine] }), { finished: [theirs] }).next.finished.length, 1))
test('a clash counts as nothing added', () =>
  is(mergeShelf(S({ finished: [mine] }), { finished: [theirs] }).added.finished, 0))

// A file describes books, never your reading of them.
test('a piled book cannot acquire a finish date', () => {
  const r = mergeShelf(S({ wishlist: [{ title: 'Piranesi', author: 'Clarke' }] }), { finished: [mine] })
  return is(r.next.wishlist[0].finishedAt, undefined) && is(r.next.wishlist[0].feeling, undefined)
})
test('and is not re-added to the record', () =>
  is(mergeShelf(S({ wishlist: [{ title: 'Piranesi', author: 'Clarke' }] }), { finished: [mine] }).next.finished.length, 0))

test('a new finished book arrives finished', () => {
  const r = mergeShelf(S(), { finished: [{ title: 'A', author: 'x' }] })
  return is(r.next.finished.length, 1) && is(r.added.finished, 1)
})
test('a new piled book arrives on the pile', () => {
  const r = mergeShelf(S(), { wishlist: [{ title: 'B', author: 'x' }] })
  return is(r.next.wishlist.length, 1) && is(r.added.wishlist, 1)
})

const capped = () => mergeShelf(
  S({ currentReads: [{ title: '1', author: 'x' }, { title: '2', author: 'x' }] }),
  { currentReads: [{ title: '3', author: 'x' }, { title: '4', author: 'x' }, { title: '5', author: 'x' }] })
test('current reads stay capped at three', () => is(capped().next.currentReads.length, 3))
test('the overflow lands on the pile', () => is(capped().next.wishlist.length, 2))
test('the counts report the split', () => is(capped().added.currentReads, 1) && is(capped().added.wishlist, 2))

const prefs = () => mergeShelf(S(), { vibe: 'seaglass', borrowFormats: ['audiobook'], findLinks: ['shop'] }).next
test('the vibe is never taken from a file', () => is(prefs().vibe, 'cottage'))
test('borrow formats are never taken from a file', () => is(prefs().borrowFormats.join(), 'ebook'))
test('find links are never taken from a file', () => is(prefs().findLinks.join(), 'library'))

test('a duplicate place is not added twice', () => {
  const r = mergeShelf(S({ library: [{ name: 'Mine', url: 'http://a' }] }),
    { library: [{ name: 'Mine', url: 'http://a' }, { name: 'Other', url: 'http://b' }] })
  return is(r.next.library.length, 2) && is(r.added.library, 1)
})

test('an empty file changes nothing', () => {
  const r = mergeShelf(S({ finished: [{ title: 'A', author: 'x' }] }), {})
  return is(r.next.finished.length, 1) && is(r.added.finished, 0)
})
test('a titleless entry is ignored', () =>
  is(mergeShelf(S(), { finished: [{ author: 'no title' }] }).next.finished.length, 0))

// The property the whole design rests on.
test('importing can never remove anything', () => {
  const r = mergeShelf(S({ finished: [{ title: 'A', author: 'x' }], wishlist: [{ title: 'B', author: 'x' }] }),
    { finished: [], wishlist: [], currentReads: [] })
  return is(r.next.finished.length, 1) && is(r.next.wishlist.length, 1)
})
