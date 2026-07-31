// Libraries and Libby.
//
// The deep links are the actual product — ordinary URLs built by string
// concatenation, which nothing can break — while the catalogue API is an
// enhancement that must fail silently. Both halves are covered here, because
// ARCHITECTURE.md says they are.
import { suite, test, is, ok } from './harness.mjs'
import {
  AVAILABILITY, libbySearchUrl, libbyTitleUrl, bookshopUrl,
  learnSearchUrl, shopSearchUrl, parseLibraryKey
} from '../js/services/libby.js'

suite('libby: the links that cannot break')

test('a library search URL is built', () =>
  ok(libbySearchUrl('kcls', 'Piranesi').startsWith('https://libbyapp.com/search/kcls/')))
test('the title is encoded into it', () =>
  ok(libbySearchUrl('kcls', 'Jonathan Strange & Mr Norrell').includes('%26')))
test('no key, no link', () => is(libbySearchUrl('', 'Piranesi'), null))
test('no title, no link', () => is(libbySearchUrl('kcls', ''), null))

test('a title URL is built from an OverDrive id', () =>
  is(libbyTitleUrl('12345'), 'https://share.libbyapp.com/title/12345'))
test('no id, no title link', () => is(libbyTitleUrl(''), null))

// Bookshop.org rather than Amazon: buying a book should be able to send money
// to a shop rather than to the company trying to replace them all.
test('the default shop link is Bookshop.org', () =>
  ok(bookshopUrl('Piranesi', 'Susanna Clarke').startsWith('https://bookshop.org/search?')))
test('a shop link needs something to search for', () => is(bookshopUrl('', ''), null))

suite('libby: pasted keys and learned shops')

// Someone pastes a Libby URL rather than knowing what a "key" is.
test('a key is pulled out of a pasted search URL', () =>
  is(parseLibraryKey('https://libbyapp.com/search/kcls/search/query-dune/page-1'), 'kcls'))
test('a key is pulled out of a pasted library URL', () =>
  is(parseLibraryKey('https://libbyapp.com/library/kcls'), 'kcls'))
test('a bare key is accepted as itself', () => is(parseLibraryKey('kcls'), 'kcls'))
test('a key is lowercased', () => is(parseLibraryKey('KCLS'), 'kcls'))
// Empty string rather than null, in both failure branches — this returns a key,
// and place-modal.js compares the result against a stored key with !==.
test('nonsense yields an empty key', () => is(parseLibraryKey('   '), ''))
test('a non-Libby URL yields an empty key', () => is(parseLibraryKey('https://example.com/x'), ''))

// There is no common pattern across bookshops — Harvard searches at /search/?q=,
// Powell's at /searchresults?keyword= — so nothing can be guessed. The shop
// teaches us: paste a results URL, and the search term is replaced with %s.
test('Harvard’s search shape is learned', () =>
  is(learnSearchUrl('https://www.harvard.com/search/?q=piranesi'),
     'https://www.harvard.com/search/?q=%s'))
test('Powell’s different shape is learned too', () =>
  is(learnSearchUrl('https://www.powells.com/searchresults?keyword=piranesi'),
     'https://www.powells.com/searchresults?keyword=%s'))
test('something that is not a search URL teaches nothing', () =>
  is(learnSearchUrl('not a url'), null))
test('a learned shape searches for a real book', () =>
  is(shopSearchUrl({ name: 'Harvard', searchUrl: 'https://www.harvard.com/search/?q=%s' }, 'Dune', 'Herbert'),
     'https://www.harvard.com/search/?q=Dune%20Herbert'))

suite('libby: the enhancement fails silently')

// The flag exists so the whole catalogue integration can be switched off if the
// undocumented API ever changes shape or starts refusing us. Its absence must
// leave no gap on screen — see the borrow row in tbr-pile.js.
test('AVAILABILITY is a plain boolean flag', () => is(typeof AVAILABILITY, 'boolean'))
test('the links do not depend on it', () =>
  ok(libbySearchUrl('kcls', 'Dune') && bookshopUrl('Dune', 'Herbert'),
    'deep links must work with the API off'))
