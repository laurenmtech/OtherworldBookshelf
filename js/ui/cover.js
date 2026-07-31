// Cover art, or nothing. There is no placeholder.
import { coverUrl } from '../services/books.js'
import { el } from './dom.js'

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
