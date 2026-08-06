// Cover art, or nothing. There is no placeholder.
import { coverUrl } from '../services/book-shape.js'
import { el } from './dom.js'

function srcFor(book, size){
  return (book && (book.coverSrc || coverUrl(book.coverId, size))) || null
}

function imgFor(url, className){
  return el('img', {
    className,
    src: url,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
    // The CSS reserves each cover's space so a list doesn't jump as they arrive,
    // which means a cover that never arrives would sit there as an empty framed
    // box — the placeholder this app is careful never to draw. So a failed one
    // takes itself out of the layout. Via the cache this sticks: the same node
    // comes back on the next render, still hidden, and doesn't retry a URL that
    // has already answered.
    onError: (e) => { e.target.style.display = 'none' }
  })
}

export function coverImg(book, { size = 'M', className = 'cover' } = {}){
  const url = srcFor(book, size)
  return url ? imgFor(url, className) : null
}

// The same thing, but handing back the element it gave you last time.
//
// A list rebuilds itself from scratch on every render — it has to, because the
// buttons close over positions (the index invariant in ARCHITECTURE.md) — and a
// brand-new <img> paints blank until it decodes, even when the bytes are already
// in the HTTP cache. That is why the covers blinked on every redraw. Moving an
// element that has already decoded costs nothing.
//
// This is NOT a diffing layer and must not grow into one. An <img> is the one
// part of a row that can safely outlive it: no click handler, no captured index,
// nothing to go stale. Rows are still thrown away and rebuilt.
//
// WHAT A "PASS" IS, AND WHY IT ISN'T A METHOD YOU CALL. Within one render the
// same cover can legitimately be asked for twice — finish a book, read it again,
// finish it again, and the record holds two entries with one cover between them.
// Handing the same node to both would move it into the second row and leave the
// first bare, so each request within a pass gets its own node. The pass ends on
// a microtask, which is the boundary that already governs this codebase:
// commit() notifies synchronously and every list rebuilds in one go, so every
// request of a render lands before the reset and no caller has to remember a
// thing.
//
// An earlier attempt asked whether a node still had a parentNode instead. It
// always did — emptying a list orphans the ROW, and an image's parent is the row
// — so nothing was ever reused and the pools grew forever. If you change this,
// prove reuse with a test rather than by reading it.
//
// ONE CACHE PER LIST. Appending a node moves it, so two lists sharing a cache
// would tear the same element out of each other on every render.
//
// `make` is a seam for the tests, which run without a DOM — the same reason
// finished-list.js exports toRows().
export function coverCache(make = imgFor){
  const pools = new Map()   // key -> the nodes handed out for it, in order
  const used = new Map()    // key -> how many of them this pass has taken
  let scheduled = false

  return function cover(book, { size = 'M', className = 'cover' } = {}){
    const url = srcFor(book, size)
    if(!url) return null
    const key = `${className}|${url}`

    if(!scheduled){
      scheduled = true
      queueMicrotask(() => { used.clear(); scheduled = false })
    }

    const nth = used.get(key) || 0
    used.set(key, nth + 1)

    let pool = pools.get(key)
    if(!pool) pools.set(key, pool = [])
    if(!pool[nth]) pool[nth] = make(url, className)
    return pool[nth]
  }
}
