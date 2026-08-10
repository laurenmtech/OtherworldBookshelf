// Duplications that must not drift.
//
// Two places in this project deliberately hold the same knowledge twice,
// because the alternative is worse in each case. Neither can be enforced by the
// module system — one crosses the client/Worker boundary, the other has to run
// before any module loads — so they are enforced here instead.
import { readFileSync } from 'node:fs'
import { suite, test, is, ok } from './harness.mjs'
import {
  slug as clientSlug, norm as clientNorm, sameTitle as clientSameTitle
} from '../js/services/book-shape.js'
import { slug as workerSlug, norm, sameTitle } from '../api/src/series.js'

// ── slug(), client vs Worker ────────────────────────────────────────────────
//
// The Worker answers what series a book is in; the client's free fallback parses
// one off an Open Library subject tag. Both derive seriesKey with slug(). If the
// two disagree, one series renders as two on the shelf — silently, and only for
// readers who happen to have books from both paths.

suite('contract: slug() across the boundary')

const FIXTURES = [
  'Throne of Glass',
  'The Mistborn Saga',
  'A Court of Thorns and Roses',
  'A_Court_of_Thorns_and_Roses',
  'Red Rising Trilogy',
  "The Hitchhiker's Guide to the Galaxy",
  'Jonathan Strange & Mr Norrell',
  '  leading and trailing  ',
  'Dune: Messiah',
  'Discworld — City Watch',
  'Æon Flux',
  '2001: A Space Odyssey',
  '',
  '---',
  'ALL CAPS SERIES'
]

for(const f of FIXTURES){
  test(`slug(${JSON.stringify(f)}) agrees`, () =>
    is(workerSlug(f), clientSlug(f), 'worker vs client'))
}

// ── The vibe boot script vs the registry ────────────────────────────────────
//
// index.html stamps data-vibe and loads the right webfont BEFORE first paint,
// which is why it cannot import js/vibes/registry.js — no module has loaded
// yet, and on a light vibe a frame of the default theme is a black flash. So
// the fonts and theme colours exist twice. Adding a vibe means adding it in
// both places, and this is what catches forgetting.

suite('contract: vibe boot script vs registry')

const html = readFileSync('index.html', 'utf8')
const registry = readFileSync('js/vibes/registry.js', 'utf8')

const boot = {}
for(const m of readFileSync('index.html', 'utf8')
  .match(/var V = \{[\s\S]*?\};/)[0]
  .matchAll(/'([\w-]+)':\s*\{\s*t:'([^']+)',\s*f:'([^']+)'/g)){
  boot[m[1]] = { theme: m[2], fonts: m[3] }
}

const reg = {}
for(const block of registry.split(/\{\s*\n?\s*id:/).slice(1)){
  const id = (block.match(/^\s*'([\w-]+)'/) || [])[1]
  if(!id) continue
  reg[id] = {
    theme: (block.match(/theme(?:Color)?:\s*'([^']+)'/) || [])[1],
    fonts: (block.match(/fonts:\s*'([^']+)'/) || [])[1]
  }
}

test('both sources list at least the five vibes', () =>
  ok(Object.keys(boot).length >= 5 && Object.keys(reg).length >= 5,
    `boot=${Object.keys(boot).length} registry=${Object.keys(reg).length}`))

test('the same set of vibes exists in both', () =>
  is(Object.keys(boot).sort().join(','), Object.keys(reg).sort().join(',')))

for(const id of Object.keys(reg).sort()){
  test(`${id}: theme colour agrees`, () => is(boot[id] && boot[id].theme, reg[id].theme))
  test(`${id}: webfont URL agrees`, () => is(boot[id] && boot[id].fonts, reg[id].fonts))
}

// ── norm()/sameTitle() ──────────────────────────────────────────────────────
// Duplicated between the Worker and js/services/book-shape.js, which is now the
// client's only copy — recommend.js and series-index.js both import it there.
// Both sides decide whether a model's title matches a real catalogue record, and
// a mismatch means the anti-invention guard failing in the direction nobody
// notices: on the client it strands a book beside its own series, in the Worker
// it throws away a series that was right.

suite('contract: title matching')

test('an ampersand spelled out still matches', () =>
  is(sameTitle('Jonathan Strange & Mr. Norrell', 'Jonathan Strange and Mr Norrell'), true))
test('a subtitle suffix still matches', () =>
  is(sameTitle('Heir of Fire: A Throne of Glass Novel', 'Heir of Fire'), true))
test('a different book does not match', () =>
  is(sameTitle('Crown of Midnight', 'Heir of Fire'), false))
test('empty never matches', () => is(sameTitle('', 'Heir of Fire'), false))
test('norm strips punctuation and case', () => is(norm('Dune: Messiah!'), 'dune messiah'))

// The client's copy has to agree with the Worker's on every one of them, or a
// book the Worker placed in a list is a book the shelf cannot find in it.
const TITLES = [
  ['Heir of Fire', 'Heir of Fire (Throne of Glass #3)'],
  ['Tower of Dawn', 'Tower of Dawn'],
  ['Jonathan Strange & Mr Norrell', 'Jonathan Strange and Mr. Norrell'],
  ['Kingdom of Ash', 'Kingdom of Fire'],
  ['Dune: Messiah', 'Dune'],
  ['', ''],
  ['A Court of Thorns and Roses', 'A Court of Thorns & Roses']
]

for(const [a, b] of TITLES){
  test(`sameTitle(${JSON.stringify(a)}, ${JSON.stringify(b)}) agrees`, () =>
    is(clientSameTitle(a, b), sameTitle(a, b), 'client vs worker'))
  test(`norm(${JSON.stringify(a)}) agrees`, () =>
    is(clientNorm(a), norm(a), 'client vs worker'))
}
