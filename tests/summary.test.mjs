// The two sources write descriptions in their own markup — Open Library in
// Markdown with source footers, Google Books in HTML. The dialog shows plain
// paragraphs, so clean() is the whole of what can go wrong here.
import { suite, test, is } from './harness.mjs'
import { clean } from '../js/services/summary.js'

suite('summary: cleaning a description')

test('a missing description is empty, not "undefined"', () => is(clean(undefined), ''))

test('Open Library’s { value } form is unwrapped', () =>
  is(clean({ type: '/type/text', value: 'A girl. A dragon.' }), 'A girl. A dragon.'))

test('the source footer and link definitions go', () =>
  is(clean('A quiet book. ([source][1])\n\n[1]: https://example.com/x'), 'A quiet book.'))

test('"Also contained in" lists after a rule go', () =>
  is(clean('The story.\n\n----------\nAlso contained in:\n- [Omnibus](/works/OL1W)'), 'The story.'))

test('Markdown links keep their words', () =>
  is(clean('By [Le Guin](https://x) and [others][2].'), 'By Le Guin and others.'))

test('Google’s HTML becomes paragraphs, entities decoded', () =>
  is(clean('<p>One &amp; two.</p><p><b>Three</b><br>four</p>'), 'One & two.\n\nThree\n\nfour'))
