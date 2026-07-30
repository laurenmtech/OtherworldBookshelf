// Current Reads: up to three books, the first one large.
//
// It was a card with a form in it until Phase 4. The form is gone — adding is
// search-first now and lives in the book modal — and the single book became a
// list, because reading three things at once is normal and an app that can only
// hold one makes you choose which two to lie about.
//
// Order is meaningful: the first entry is the headline. That's why reordering
// is a store action rather than a local sort, and why it has a keyboard path
// and not only a drag.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey } from '../services/books.js'
import { subtitle, tagRow } from '../ui/book-meta.js'
import { subscribe, getState, reorderCurrent } from '../state/store.js'

export function mountCurrentReads(root, { finishModal, bookModal, setDownModal }){
  const list = root.querySelector('#current-list')
  const empty = root.querySelector('#current-empty')
  const addBtn = root.querySelector('#add-current-btn')

  addBtn && addBtn.addEventListener('click', () => bookModal.open({ dest: 'current' }))

  // Held across a re-render: the store commit that a drop causes re-renders the
  // list underneath the drag, and the source index has to survive that.
  let dragFrom = null

  // Reordering rebuilds the list, which destroys the button that was just
  // pressed — so a keyboard user would lose focus to the body on every press
  // and have to tab back in to move a book twice. This carries focus to the
  // same control in the book's new position.
  let refocus = null

  function entry(book, idx, total){
    const headline = idx === 0
    const li = el('li', {
      className: `current-item${headline ? ' headline' : ''}`,
      'data-book-key': bookKey(book),
      draggable: 'true'
    })

    const art = coverImg(book, { size: headline ? 'M' : 'S', className: 'current-cover' })
    if(art) li.appendChild(art)

    const bits = subtitle(book).map(escapeHtml).join(' · ')
    const meta = el('div', {
      className: 'current-meta',
      html: `<h3>${escapeHtml(book.title)}</h3>` +
            (bits ? `<div class="muted">${bits}</div>` : '') +
            tagRow(book)
    })

    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Finish', () => finishModal.open(idx, book)),
      iconButton('setdown', 'Set down', () => setDownModal.open(idx)),
      iconButton('edit', 'Edit', () => bookModal.open({ dest: 'current', index: idx, entry: book }))
    )

    // The keyboard path for reordering, and the touch one: dragging is a mouse
    // idiom, and neither a screen reader nor a phone should be shut out of
    // deciding which book is the headline.
    if(total > 1){
      const move = el('div', { className: 'reorder' })
      const step = (dir) => () => {
        refocus = { key: bookKey(book), dir }
        reorderCurrent(idx, dir === 'up' ? idx - 1 : idx + 1)
      }
      const up = iconButton('up', '', step('up'), 'btn icon-only')
      const down = iconButton('down', '', step('down'), 'btn icon-only')
      up.setAttribute('aria-label', `Move “${book.title}” up`)
      down.setAttribute('aria-label', `Move “${book.title}” down`)
      up.setAttribute('data-move', 'up')
      down.setAttribute('data-move', 'down')
      up.disabled = idx === 0
      down.disabled = idx === total - 1
      move.appendChild(up)
      move.appendChild(down)
      actions.appendChild(move)
    }

    meta.appendChild(actions)
    li.appendChild(meta)

    li.addEventListener('dragstart', (e) => {
      dragFrom = idx
      li.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
      try{ e.dataTransfer.setData('text/plain', String(idx)) }catch(err){ /* Safari */ }
    })
    li.addEventListener('dragend', () => { dragFrom = null; li.classList.remove('dragging') })
    li.addEventListener('dragover', (e) => {
      if(dragFrom === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      li.classList.add('drag-over')
    })
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'))
    li.addEventListener('drop', (e) => {
      e.preventDefault()
      li.classList.remove('drag-over')
      const from = dragFrom === null ? Number(e.dataTransfer.getData('text/plain')) : dragFrom
      dragFrom = null
      if(Number.isInteger(from)) reorderCurrent(from, idx)
    })

    return li
  }

  // Renders whatever the state holds rather than capping to CURRENT_CAP. The
  // cap is enforced where books are added; hiding one here would make a book
  // someone owns invisible instead of merely surplus.
  function render(state){
    const books = state.currentReads
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', books.length > 0)
    books.forEach((book, idx) => list.appendChild(entry(book, idx, books.length)))
    restoreFocus()
  }

  // The book that just moved now sits at an end often enough that the button
  // pressed to get it there is disabled — so fall back to the opposite one
  // rather than dropping focus. Either way it stays on that book's controls.
  function restoreFocus(){
    if(!refocus) return
    const { key, dir } = refocus
    refocus = null
    const li = Array.from(list.children).find(n => n.getAttribute('data-book-key') === key)
    if(!li) return
    const wanted = li.querySelector(`[data-move="${dir}"]`)
    const other = li.querySelector(`[data-move="${dir === 'up' ? 'down' : 'up'}"]`)
    const target = (wanted && !wanted.disabled) ? wanted : ((other && !other.disabled) ? other : null)
    if(target) target.focus()
  }

  render(getState())
  return subscribe(render)
}
