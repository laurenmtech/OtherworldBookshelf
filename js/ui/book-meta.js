// How a book describes itself in a list: the line under the title, the genre and
// format tags, and "Book 2 of 7". Shared so a book doesn't look like three
// different things depending on the panel.
import { escapeHtml } from './dom.js'
import { FORMATS } from '../services/book-shape.js'

const formatLabel = (k) => (FORMATS.find(f => f.key === k) || {}).label

export function volumeLabel(book){
  if(!book || !Number.isFinite(book.seriesPosition)) return ''
  return Number.isFinite(book.seriesTotal)
    ? `Book ${book.seriesPosition} of ${book.seriesTotal}`
    : `Book ${book.seriesPosition}`
}

export function subtitle(book){
  const series = book.seriesName
    ? book.seriesName + (book.seriesPosition ? ` #${book.seriesPosition}` : '')
    : ''
  return [book.author, book.year, series].filter(Boolean)
}

export function tagRow(book){
  const tags = [...(book.genres || []), formatLabel(book.format)].filter(Boolean)
  if(!tags.length) return ''
  return `<div class="tag-row">${tags.map(t => `<span class="book-tag">${escapeHtml(t)}</span>`).join('')}</div>`
}
