// Phase 7: what finishing a volume does next.
//
// nextVolume() is pure and local — everything it needs is already on the book —
// so all of this runs with no network and no DOM.
import { suite, test, is, ok } from './harness.mjs'
import { nextVolume, unreadVolume } from '../js/services/series.js'

suite('series: advancing')

const TOG = ['Throne of Glass', 'Crown of Midnight', 'Heir of Fire', 'Queen of Shadows',
             'Empire of Storms', 'Tower of Dawn', 'Kingdom of Ash']

const vols = (over = {}) =>
  TOG.map((t, i) => ({ title: t, author: 'Sarah J. Maas', verified: true, ...(over[i] || {}) }))

const at = (pos, over = {}) => ({
  title: TOG[pos - 1], author: 'Sarah J. Maas',
  seriesKey: 'throne-of-glass', seriesName: 'Throne of Glass',
  seriesPosition: pos, seriesTotal: 7, seriesVolumes: vols(over)
})

const S = (o = {}) => ({ currentReads: [], wishlist: [], finished: [], ...o })
const YEAR = new Date().getFullYear()

test('walks a whole series without a single lookup', () => {
  let book = at(1), state = S(), steps = []
  for(let i = 0; i < 10; i++){
    const r = nextVolume(book, state)
    if(!r) break
    steps.push(r.book.title)
    state = S({ finished: [...state.finished, book] })
    book = r.book
  }
  return is(steps.join(' > '),
    'Crown of Midnight > Heir of Fire > Queen of Shadows > Empire of Storms > Tower of Dawn > Kingdom of Ash')
})

test('the volume list travels forward', () => is(nextVolume(at(1), S()).book.seriesVolumes.length, 7))
test('position advances with it', () => is(nextVolume(at(1), S()).book.seriesPosition, 2))

// The regression that caused the rewrite: asked about Heir of Fire, the model
// answered "Crescent City" and the chain died three books in.
test('Heir of Fire advances to Queen of Shadows', () => is(nextVolume(at(3), S()).book.title, 'Queen of Shadows'))
test('and keeps the right series name', () => is(nextVolume(at(3), S()).book.seriesName, 'Throne of Glass'))

test('the last volume ends the series', () => is(nextVolume(at(7), S()), null))
test('a standalone advances nothing', () => is(nextVolume({ title: 'Piranesi' }, S()), null))
test('a detached series advances nothing', () => is(nextVolume({ ...at(1), seriesDetached: true }, S()), null))
test('a re-read advances nothing', () => is(nextVolume(at(1), S({ finished: [at(1)] })), null))
test('no list, no advance', () => is(nextVolume({ ...at(1), seriesVolumes: undefined }, S()), null))
test('no position, no advance', () => is(nextVolume({ ...at(1), seriesPosition: undefined }, S()), null))

test('skips a volume already in the record', () =>
  is(nextVolume(at(1), S({ finished: [at(2)] })).book.title, 'Heir of Fire'))

test('promotes from the pile rather than duplicating', () => {
  const r = nextVolume(at(1), S({ wishlist: [{ title: 'Crown of Midnight', author: 'Sarah J. Maas', coverId: 99 }] }))
  return is(r.fromWishlist, 0)
})
test('keeps what the pile entry already knew', () => {
  const r = nextVolume(at(1), S({ wishlist: [{ title: 'Crown of Midnight', author: 'Sarah J. Maas', coverId: 99 }] }))
  return is(r.book.coverId, 99)
})
test('gives the pile entry its series identity', () => {
  const r = nextVolume(at(1), S({ wishlist: [{ title: 'Crown of Midnight', author: 'Sarah J. Maas', coverId: 99 }] }))
  return is(r.book.seriesPosition, 2)
})
// bookKey is title+author everywhere in the app; matching more loosely here
// would contradict the rest of the shelf.
test('an authorless pile entry is a different book', () =>
  is(nextVolume(at(1), S({ wishlist: [{ title: 'Crown of Midnight' }] })).fromWishlist, null))

test('never advances onto an unverified volume', () =>
  is(nextVolume(at(1, { 1: { verified: false } }), S()), null))

test('an unpublished next volume goes to the pile', () =>
  is(nextVolume(at(1, { 1: { year: YEAR + 2 } }), S()).forthcoming, true))
test('a published next volume does not', () =>
  is(nextVolume(at(1, { 1: { year: YEAR - 1 } }), S()).forthcoming, false))
test('an unknown year counts as published', () =>
  is(nextVolume(at(1), S()).forthcoming, false))

// ── The record's copy of the walk ────────────────────────────────────────────
//
// unreadVolume() exists because a book can learn its series days after it was
// finished (services/series-backfill.js), long past the finish modal that would
// have announced it. Same walk, one rule inverted: it answers ABOUT a book that
// is already in the record.
suite('series: what is still unread')

test('book 1 in the record still points at book 2', () =>
  is(unreadVolume(at(1), S({ finished: [at(1)] })).title, 'Crown of Midnight'))

test('it carries the whole list forward', () =>
  is(unreadVolume(at(1), S({ finished: [at(1)] })).seriesVolumes.length, 7))

test('and the position it will sit at', () =>
  is(unreadVolume(at(1), S({ finished: [at(1)] })).seriesPosition, 2))

test('volumes already read are skipped', () =>
  is(unreadVolume(at(1), S({ finished: [at(1), at(2), at(3)] })).title, 'Queen of Shadows'))

test('the last volume leaves nothing to offer', () =>
  is(unreadVolume(at(7), S({ finished: [at(7)] })), null))

// The offer is only worth making for a book the reader doesn't have. These are
// silence rather than a promotion: the record never moves anything.
test('nothing is offered when the next volume is on the pile', () =>
  is(unreadVolume(at(1), S({ finished: [at(1)], wishlist: [at(2)] })), null))

test('nor when it is already being read', () =>
  is(unreadVolume(at(1), S({ finished: [at(1)], currentReads: [at(2)] })), null))

// The rules nextVolume() keeps, kept here too.
test('never offers an unverified volume', () =>
  is(unreadVolume(at(1, { 1: { verified: false } }), S({ finished: [at(1)] })), null))

test('never offers a book that is not out yet', () =>
  is(unreadVolume(at(1, { 1: { year: YEAR + 2 } }), S({ finished: [at(1)] })), null))

test('a detached series offers nothing', () =>
  is(unreadVolume({ ...at(1), seriesDetached: true }, S({ finished: [at(1)] })), null))

// "Not for me" never advances a series — including afterwards, from the record.
test('a book that was set down offers nothing', () =>
  is(unreadVolume({ ...at(1), setDown: true }, S({ finished: [at(1)] })), null))

test('a standalone offers nothing', () =>
  is(unreadVolume({ title: 'Piranesi' }, S({ finished: [{ title: 'Piranesi' }] })), null))
