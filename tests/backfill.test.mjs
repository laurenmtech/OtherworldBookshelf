// Books added while the search was unreachable, filled in when it comes back.
//
// The whole safety argument of this feature is strictMatch(): it runs unattended,
// days after the reader typed the title, so a wrong answer arrives silently and is
// believed. These tests are that argument, and they are the reason it may not be
// loosened into "take the first result".
import { suite, test, is, ok } from './harness.mjs'
import { strictMatch, pending, MAX_TRIES } from '../js/services/backfill.js'

// The store writes through to localStorage, which doesn't exist in node. The real
// adapter swallows the error, but it logs — and a suite that prints a stack on
// every passing commit is a suite people stop reading.
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
const { applyRemote, applyDetails, noteDetailsMiss, replaceBook, getState } =
  await import('../js/state/store.js')

suite('offline adds: matching')

const found = (title, author, extra = {}) => ({ title, author, ...extra })

test('an exact title with no author typed is taken', () =>
  is(strictMatch({ title: 'Piranesi' }, [found('Piranesi', 'Susanna Clarke')]).author,
     'Susanna Clarke'))

test('case and punctuation do not matter', () =>
  ok(strictMatch({ title: 'the fifth season' }, [found('The Fifth Season', 'N. K. Jemisin')])))

test('a surname matches the full name on the result', () =>
  ok(strictMatch({ title: 'The Hobbit', author: 'Tolkien' },
                 [found('The Hobbit', 'J. R. R. Tolkien')])))

// The reason authorAgrees() compares whole words rather than substrings.
test('a surname that is a prefix of another is not a match', () =>
  is(strictMatch({ title: 'Demon Copperhead', author: 'King' },
                 [found('Demon Copperhead', 'Barbara Kingsolver')]), null))

test('a different author is refused', () =>
  is(strictMatch({ title: 'Babel', author: 'R. F. Kuang' },
                 [found('Babel', 'Alan Moore')]), null))

test('a near-miss title is refused', () =>
  is(strictMatch({ title: 'Piranesi' }, [found('Piranesi and Other Essays', 'Someone')]), null))

// Two books of the same name is exactly where a guess goes wrong, so ambiguity
// refuses rather than picking the better-ranked one.
test('two books of the same title are refused', () =>
  is(strictMatch({ title: 'Babel' },
                 [found('Babel', 'R. F. Kuang'), found('Babel', 'Alan Moore')]), null))

test('an author, typed, breaks that tie', () =>
  is(strictMatch({ title: 'Babel', author: 'Kuang' },
                 [found('Babel', 'R. F. Kuang'), found('Babel', 'Alan Moore')]).author,
     'R. F. Kuang'))

test('no results is not a match', () => is(strictMatch({ title: 'Piranesi' }, []), null))

test('an empty title never matches', () =>
  is(strictMatch({ title: '' }, [found('', 'Nobody')]), null))

suite('offline adds: the waiting list')

const shelf = (o = {}) => ({
  currentReads: [], wishlist: [], finished: [], library: [], bookstores: [],
  passed: [], vibe: 'cottage', borrowFormats: [], findLinks: [], ...o
})

test('only books that asked for details are pending', () =>
  is(pending(shelf({
    wishlist: [{ title: 'A', needsDetails: true }, { title: 'B' }],
    finished: [{ title: 'C', needsDetails: true }]
  })).length, 2))

test('a pending book with no title is skipped', () =>
  is(pending(shelf({ wishlist: [{ needsDetails: true }] })).length, 0))

suite('offline adds: filling in')

const tbr = () => getState().wishlist[0]

test('details fill the blanks and clear the flag', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Piranesi', needsDetails: true }] }))
  applyDetails('t:piranesi|', { author: 'Susanna Clarke', year: 2020, coverId: 42 })
  const book = tbr()
  return ok(book.author === 'Susanna Clarke' && book.year === 2020 && book.coverId === 42
            && book.needsDetails === undefined)
})

// The reader typed it, so it is the record. A catalogue does not get to correct it.
test('what the reader typed is never overwritten', () => {
  applyRemote(shelf({
    wishlist: [{ title: 'Piranesi', author: 'S. Clarke', needsDetails: true }]
  }))
  applyDetails('t:piranesi|s. clarke', { author: 'Susanna Clarke', year: 2020 })
  return ok(tbr().author === 'S. Clarke' && tbr().year === 2020)
})

// bookKey() prefers workKey, and mergeShelf() matches purely on bookKey — so a
// backfill that attached one would make two devices disagree about which book is
// which and duplicate it on the next sync.
test('a workKey is never attached', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Piranesi', needsDetails: true }] }))
  applyDetails('t:piranesi|', { workKey: '/works/OL1W', author: 'Susanna Clarke' })
  return is(tbr().workKey, undefined)
})

test('a book that never asked for details is left alone', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Piranesi' }] }))
  return is(applyDetails('t:piranesi|', { author: 'Susanna Clarke' }), false)
})

test('a miss counts, and the book keeps waiting', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Pirenesi', needsDetails: true }] }))
  const gaveUp = noteDetailsMiss('t:pirenesi|', MAX_TRIES)
  return ok(gaveUp === false && tbr().detailsTries === 1 && tbr().needsDetails === true)
})

// Otherwise a book the catalogue simply doesn't have searches on every app open,
// for as long as it is on the pile.
test('it gives up after MAX_TRIES and becomes an ordinary hand-typed book', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Pirenesi', needsDetails: true }] }))
  let gaveUp = false
  for(let i = 0; i < MAX_TRIES; i++) gaveUp = noteDetailsMiss('t:pirenesi|', MAX_TRIES)
  return ok(gaveUp === true && tbr().needsDetails === undefined
            && tbr().detailsTries === undefined && tbr().title === 'Pirenesi')
})

suite('offline adds: naming one by hand')

// The typo case, which is most of why a lookup fails to settle: here the reader
// picked the book, so the catalogue title replaces theirs.
test('picking a book replaces the title', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Pirenesi', needsDetails: true }] }))
  replaceBook('t:pirenesi|', { title: 'Piranesi', author: 'Susanna Clarke', workKey: '/works/OL1W' })
  return ok(tbr().title === 'Piranesi' && tbr().author === 'Susanna Clarke'
            && tbr().needsDetails === undefined)
})

test('what the shelf knows survives the replacement', () => {
  applyRemote(shelf({
    finished: [{ title: 'Pirenesi', needsDetails: true, feeling: 'loved',
                 moods: ['strange'], finishedAt: '2026-01-04' }]
  }))
  replaceBook('t:pirenesi|', { title: 'Piranesi', author: 'Susanna Clarke' })
  const book = getState().finished[0]
  return ok(book.feeling === 'loved' && book.moods[0] === 'strange'
            && book.finishedAt === '2026-01-04' && book.title === 'Piranesi')
})

test('a replacement carries no workKey either', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Pirenesi', needsDetails: true }] }))
  replaceBook('t:pirenesi|', { title: 'Piranesi', author: 'Susanna Clarke', workKey: '/works/OL1W' })
  return is(tbr().workKey, undefined)
})

test('replacing a book that is not there changes nothing', () => {
  applyRemote(shelf({ wishlist: [{ title: 'Piranesi' }] }))
  return is(replaceBook('t:nothing|', { title: 'Whatever' }), false)
})
