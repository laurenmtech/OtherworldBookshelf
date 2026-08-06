// The covers blinked because every render built brand-new <img> elements, and a
// new image paints blank until it decodes even when the bytes are already in
// cache. coverCache() hands back the element it gave you last time.
//
// The first attempt at this shipped doing NOTHING — it asked whether a node
// still had a parentNode, which it always did, because emptying a list orphans
// the row and an image's parent is the row. It looked right and reused nothing.
// So the point of this file is the one assertion that catches that: across two
// passes, the same cover must be the same object.
import { suite, test, is, ok } from './harness.mjs'
import { coverCache } from '../js/ui/cover.js'

suite('covers: the same element twice')

// The seam: no DOM here, so nodes are plain objects that remember their url.
const fake = () => {
  let n = 0
  return (url, className) => ({ id: ++n, url, className })
}

const book = { coverId: 42 }
const other = { coverId: 99 }
const S = { size: 'S', className: 'row-cover' }

// A pass ends on a microtask, so awaiting one is how a test says "next render".
const nextPass = () => Promise.resolve()

test('a book with no cover gets nothing, not a frame', () =>
  is(coverCache(fake())({ title: 'Untitled' }, S), null))

test('the same cover in the next pass is the same element', async () => {
  const cover = coverCache(fake())
  const first = cover(book, S)
  await nextPass()
  return is(cover(book, S), first)
})

test('and still is, several passes later', async () => {
  const cover = coverCache(fake())
  const first = cover(book, S)
  for(let i = 0; i < 5; i++){ await nextPass(); cover(book, S) }
  await nextPass()
  return is(cover(book, S), first)
})

test('different books get different elements', async () => {
  const cover = coverCache(fake())
  return ok(cover(book, S) !== cover(other, S))
})

// Finish a book, read it again, finish it again: one cover, two rows. Sharing
// the node would move it into the second row and leave the first one bare.
test('the same cover twice in ONE pass gets two elements', () => {
  const cover = coverCache(fake())
  return ok(cover(book, S) !== cover(book, S))
})

test('and both of those are reused next pass, in order', async () => {
  const cover = coverCache(fake())
  const a = cover(book, S), b = cover(book, S)
  await nextPass()
  return is(cover(book, S), a) && is(cover(book, S), b)
})

// Current Reads draws the headline cover larger, so the size is part of what
// makes two requests the same request.
test('a different size is a different element', async () => {
  const cover = coverCache(fake())
  const small = cover(book, { size: 'S', className: 'current-cover' })
  return ok(cover(book, { size: 'M', className: 'current-cover' }) !== small)
})

test('so is a different class', async () => {
  const cover = coverCache(fake())
  return ok(cover(book, { size: 'S', className: 'row-cover' })
         !== cover(book, { size: 'S', className: 'current-cover' }))
})

// One cache per list is the rule; this is what goes wrong without it.
test('two caches never hand out the same element', () => {
  const make = fake()
  return ok(coverCache(make)(book, S) !== coverCache(make)(book, S))
})

test('a pool holds only as many as one pass asked for', async () => {
  const make = fake()
  let built = 0
  const counting = (url, cls) => { built++; return make(url, cls) }
  const cover = coverCache(counting)
  for(let i = 0; i < 10; i++){ cover(book, S); await nextPass() }
  return is(built, 1)
})
