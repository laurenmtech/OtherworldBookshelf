// The TBR pile: what's next, sorted by title.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { subscribe, getState, removeTbr, makeTbrCurrent } from '../state/store.js'

export function mountTbrPile(root, { bookModal }){
  const list = root.querySelector('#wishlist')
  const empty = root.querySelector('#wishlist-empty')
  const addBtn = root.querySelector('#add-wish-btn')

  addBtn && addBtn.addEventListener('click', () => bookModal.open())

  function row(book, idx){
    const li = el('li')
    const left = el('div', {
      html: `<div class=small-meta><span class="wishlist-title">${escapeHtml(book.title)}</span>` +
            `<div class=muted>${escapeHtml(book.author || '')}</div></div>`
    })
    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Set current', () => makeTbrCurrent(idx)),
      iconButton('edit', 'Edit', () => bookModal.open(idx, book)),
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
