// Saved places: libraries AND bookstores, one implementation. A library entry with
// a libraryKey is a real library and gets borrow links; one without is a bookmark.
// That key is the whole type system — there is deliberately no `kind` field.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { subscribe, getState } from '../state/store.js'

export function mountPlaceList(root, { modal, select, remove, extraAction, reorder } = {}){
  if(!root) return
  const list = root.querySelector('[data-place-list]')
  const empty = root.querySelector('[data-place-empty]')
  const addBtn = root.querySelector('[data-place-add]')

  addBtn && addBtn.addEventListener('click', () => modal.open())
  const emptyAction = empty && empty.querySelector('[data-empty-action]')
  emptyAction && emptyAction.addEventListener('click', () => modal.open())

  let refocus = null

  function row(entry, idx, total){
    const li = el('li', { 'data-place-name': entry.name || '' })
    const url = escapeHtml(entry.url || '')
    const link = url
      ? `<div class=muted><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></div>`
      : ''
    const official = entry.officialName && entry.officialName !== entry.name
      ? `<div class="muted place-official">${escapeHtml(entry.officialName)}</div>`
      : ''
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
