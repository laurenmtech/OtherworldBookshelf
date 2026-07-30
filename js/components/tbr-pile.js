// The TBR pile: what's next, sorted by title.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey } from '../services/books.js'
import { subtitle, tagRow } from '../ui/book-meta.js'
import { subscribe, getState, removeTbr, makeTbrCurrent } from '../state/store.js'

export function mountTbrPile(root, { bookModal }){
  const list = root.querySelector('#wishlist')
  const empty = root.querySelector('#wishlist-empty')
  const addBtn = root.querySelector('#add-wish-btn')

  addBtn && addBtn.addEventListener('click', () => bookModal.open({ dest: 'tbr' }))

  function row(book, idx){
    // data-book-key is what "you already have this — go to it" finds.
    const li = el('li', { 'data-book-key': bookKey(book) })

    // A book set down as "not right now" keeps whatever you said about it, so
    // picking it up again comes with the note you left yourself.
    const moodTags = (book.moods && book.moods.length)
      ? `<div class="mood-row">${book.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
      : ''
    const bits = subtitle(book).map(escapeHtml).join(' · ')
    const left = el('div', { className: 'row-main' })
    const art = coverImg(book, { size: 'S', className: 'row-cover' })
    if(art) left.appendChild(art)
    left.appendChild(el('div', {
      className: 'small-meta',
      html: `<span class="wishlist-title">${escapeHtml(book.title)}</span>` +
            `<div class=muted>${bits}</div>${tagRow(book)}${moodTags}`
    }))

    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Set current', () => makeTbrCurrent(idx)),
      iconButton('edit', 'Edit', () => bookModal.open({ dest: 'tbr', index: idx, entry: book })),
      iconButton('trash', 'Remove', () => removeTbr(idx))
    )
    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  function render(state){
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', state.wishlist.length > 0)
    state.wishlist.forEach((book, idx) => list.appendChild(row(book, idx)))
  }

  render(getState())
  return subscribe(render)
}
