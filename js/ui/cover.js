// Cover art, or nothing at all.
//
// There is no placeholder. A book with no cover gets no element, so a shelf of
// hand-typed books reads as a list rather than as a grid of grey rectangles
// apologising for themselves.
import { coverUrl } from '../services/books.js'
import { el } from './dom.js'

// Lazy by default: three current reads and a long pile would otherwise fetch
// every image before the first one is scrolled to. The alt text is empty on
// purpose — the title is right next to it in the DOM, and "Cover of X" would
// only make a screen reader say the title twice.
// coverSrc is a whole URL and comes from Google Books, which serves its own
// thumbnails at a fixed size; coverId is Open Library's, where the size is ours
// to choose. Either way the caller asks for a size and gets the best available.
export function coverImg(book, { size = 'M', className = 'cover' } = {}){
  const url = book && (book.coverSrc || coverUrl(book.coverId, size))
  if(!url) return null
  return el('img', {
    className,
    src: url,
    alt: '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer'
  })
}
