// Libraries and bookshops. Phase 2 moves this into the settings sheet; for now
// it stays a panel, exactly where it was.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { subscribe, getState, removeLibrary, makeLibraryCurrent } from '../state/store.js'

export function mountLibraries(root, { libraryModal }){
  const list = root.querySelector('#library')
  const empty = root.querySelector('#library-empty')
  const addBtn = root.querySelector('#add-library-btn')

  addBtn && addBtn.addEventListener('click', () => libraryModal.open())

  function row(entry, idx){
    const li = el('li')
    const url = escapeHtml(entry.url || '')
    const left = el('div', {
      html: `<div class=small-meta><span class=wishlist-title>${escapeHtml(entry.name)}</span>` +
            `<div class=muted><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></div></div>`
    })
    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Set current', () => makeLibraryCurrent(idx)),
      iconButton('edit', 'Edit', () => libraryModal.open(idx, entry)),
      iconButton('trash', 'Remove', () => removeLibrary(idx))
    )
    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  function render(state){
    if(!list) return
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', state.library.length > 0)
    state.library.forEach((entry, idx) => list.appendChild(row(entry, idx)))
  }

  render(getState())
  return subscribe(render)
}
