// How a book describes itself in a list: the line under the title, and the
// small tags beside it.
//
// Shared by Current Reads, the TBR pile and the record, because a book should
// not look like three different things depending on which panel it is sitting
// in — and because the alternative was the record importing the Current Reads
// panel for a formatting helper.
import { escapeHtml } from './dom.js'
import { FORMATS } from '../services/books.js'

export const formatLabel = (k) => (FORMATS.find(f => f.key === k) || {}).label

// Author, year, series — whatever this book actually knows about itself. A
// hand-typed book knows only its author, and shows only that. Returned as
// parts so each caller can join them into its own layout.
export function subtitle(book){
  const series = book.seriesName
    ? book.seriesName + (book.seriesPosition ? ` #${book.seriesPosition}` : '')
    : ''
  return [book.author, book.year, series].filter(Boolean)
}

// Genre and format read as the same kind of thing — a small word about the
// book rather than about you — so they share a row and a look. Vibes are
// deliberately NOT in here: those are what you thought of it, which is a
// different claim and gets its own row.
export function tagRow(book){
  const tags = [...(book.genres || []), formatLabel(book.format)].filter(Boolean)
  if(!tags.length) return ''
  return `<div class="tag-row">${tags.map(t => `<span class="book-tag">${escapeHtml(t)}</span>`).join('')}</div>`
}
