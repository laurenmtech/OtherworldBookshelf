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
// reorder(from, to) -> an optional store action; enables the move controls
export function mountPlaceList(root, { modal, select, remove, extraAction, reorder } = {}){
  if(!root) return
  const list = root.querySelector('[data-place-list]')
  const empty = root.querySelector('[data-place-empty]')
  const addBtn = root.querySelector('[data-place-add]')

  addBtn && addBtn.addEventListener('click', () => modal.open())

  // Reordering rebuilds the list, which destroys the button just pressed, so a
  // keyboard user would lose focus to the body on every press. Same fix as the
  // current reads list: carry focus to the same control in the new position.
  let refocus = null

  function row(entry, idx, total){
    const li = el('li', { 'data-place-name': entry.name || '' })
    const url = escapeHtml(entry.url || '')
    const link = url
      ? `<div class=muted><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></div>`
      : ''
    // The official name only appears when it isn't what you called it. Showing
    // "King County Library System" under a label that already says exactly that
    // is noise; showing it under "Mom's card" is the whole point — it's how two
    // similarly-named entries stay tellable apart.
    const official = entry.officialName && entry.officialName !== entry.name
      ? `<div class="muted place-official">${escapeHtml(entry.officialName)}</div>`
      : ''
    // Only the first library is used for availability, so it says so rather
    // than leaving you to infer it from position.
    const primary = reorder && idx === 0 && total > 1 && entry.libraryKey
      ? '<span class="place-badge">Primary</span>'
      : ''
    const left = el('div', {
      html: `<div class=small-meta><span class=wishlist-title>${escapeHtml(entry.name)}</span>${primary}` +
            `${official}${link}</div>`
    })

    const extra = extraAction ? extraAction(entry, idx) : null
    const actions = el('div', { className: 'list-actions' },
      extra,
      iconButton('edit', 'Edit', () => modal.open(idx, entry)),
      iconButton('trash', 'Remove', () => remove(idx))
    )

    if(reorder && total > 1){
      const move = el('div', { className: 'reorder' })
      const step = (dir) => () => {
        refocus = { name: entry.name || '', dir }
        reorder(idx, dir === 'up' ? idx - 1 : idx + 1)
      }
      const up = iconButton('up', '', step('up'), 'btn icon-only')
      const down = iconButton('down', '', step('down'), 'btn icon-only')
      up.setAttribute('aria-label', `Move “${entry.name}” up`)
      down.setAttribute('aria-label', `Move “${entry.name}” down`)
      up.setAttribute('data-move', 'up')
      down.setAttribute('data-move', 'down')
      up.disabled = idx === 0
      down.disabled = idx === total - 1
      move.appendChild(up)
      move.appendChild(down)
      actions.appendChild(move)
    }

    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  function restoreFocus(){
    if(!refocus) return
    const { name, dir } = refocus
    refocus = null
    const li = Array.from(list.children).find(n => n.getAttribute('data-place-name') === name)
    if(!li) return
    const wanted = li.querySelector(`[data-move="${dir}"]`)
    const other = li.querySelector(`[data-move="${dir === 'up' ? 'down' : 'up'}"]`)
    const target = (wanted && !wanted.disabled) ? wanted : ((other && !other.disabled) ? other : null)
    if(target) target.focus()
  }

  function render(state){
    if(!list) return
    const items = select(state)
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', items.length > 0)
    items.forEach((entry, idx) => list.appendChild(row(entry, idx, items.length)))
    restoreFocus()
  }

  render(getState())
  return subscribe(render)
}
