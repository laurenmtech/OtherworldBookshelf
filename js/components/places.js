// A saved list of places — libraries, and the bookshops you like.
//
// Both are the same thing: a name, a link, and add/edit/remove. This replaces
// the library-only component rather than sitting beside a copy of it, which is
// the same call modal.js made in Phase 1 and for the same reason.
//
// The container supplies its own hooks so one implementation can serve both
// sections of the settings sheet:
//   [data-place-add]    the "+ Add" button
//   [data-place-list]   the <ul> to fill
//   [data-place-empty]  the message shown when there's nothing yet
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { subscribe, getState } from '../state/store.js'

// select(state) -> the array to render · remove(index) -> a store action
// extraAction(entry, index) -> an optional leading button, or null
export function mountPlaceList(root, { modal, select, remove, extraAction } = {}){
  if(!root) return
  const list = root.querySelector('[data-place-list]')
  const empty = root.querySelector('[data-place-empty]')
  const addBtn = root.querySelector('[data-place-add]')

  addBtn && addBtn.addEventListener('click', () => modal.open())

  function row(entry, idx){
    const li = el('li')
    const url = escapeHtml(entry.url || '')
    const link = url
      ? `<div class=muted><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></div>`
      : ''
    const left = el('div', {
      html: `<div class=small-meta><span class=wishlist-title>${escapeHtml(entry.name)}</span>${link}</div>`
    })
    const extra = extraAction ? extraAction(entry, idx) : null
    const actions = el('div', { className: 'list-actions' },
      extra,
      iconButton('edit', 'Edit', () => modal.open(idx, entry)),
      iconButton('trash', 'Remove', () => remove(idx))
    )
    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  function render(state){
    if(!list) return
    const items = select(state)
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', items.length > 0)
    items.forEach((entry, idx) => list.appendChild(row(entry, idx)))
  }

  render(getState())
  return subscribe(render)
}
