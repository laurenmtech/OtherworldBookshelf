// Current Reads: up to three books, the first one large. Order is meaningful, so
// reordering is a store action rather than a local sort.
//
// The Remove handler re-resolves its book by bookKey AFTER the dialog resolves.
// The dialog is a promise where confirm() was a block — see the index invariant in
// ARCHITECTURE.md.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey, inSeries } from '../services/books.js'
import { subtitle, tagRow, volumeLabel } from '../ui/book-meta.js'
import { askConfirm } from '../ui/dialog.js'
import { subscribe, getState, reorderCurrent, removeCurrent, detachSeries } from '../state/store.js'

export function mountCurrentReads(root, { finishModal, bookModal, setDownModal }){
  const list = root.querySelector('#current-list')
  const empty = root.querySelector('#current-empty')
  const addBtn = root.querySelector('#add-current-btn')

  addBtn && addBtn.addEventListener('click', () => bookModal.open({ dest: 'current' }))
  const emptyAction = empty && empty.querySelector('[data-empty-action]')
  emptyAction && emptyAction.addEventListener('click', () => bookModal.open({ dest: 'current' }))

  let dragFrom = null

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

    const series = inSeries(book)
    const meta = el('div', { className: 'current-meta' })
    if(series){
      const line = [book.author, volumeLabel(book)].filter(Boolean).map(escapeHtml).join(' · ')
      meta.innerHTML =
        `<h3>${escapeHtml(book.seriesName)}</h3>` +
        `<div class="series-volume">${escapeHtml(book.title)}</div>` +
        (line ? `<div class="muted">${line}</div>` : '') +
        tagRow(book)
    } else {
      const bits = subtitle(book).map(escapeHtml).join(' · ')
      meta.innerHTML =
        `<h3>${escapeHtml(book.title)}</h3>` +
        (bits ? `<div class="muted">${bits}</div>` : '') +
        tagRow(book)
    }

    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Finish', () => finishModal.open(idx, book)),
      iconButton('setdown', 'Set down', () => setDownModal.open(idx)),
      iconButton('trash', 'Remove', async () => {
        const key = bookKey(book)
        const ok = await askConfirm({
          title: `Remove “${book.title}”?`,
          body: 'It goes nowhere — not to the record, not back to the TBR pile.\n\n' +
                'Finish it or set it down instead if you want it remembered.',
          confirm: 'Remove',
          danger: true
        })
        if(!ok) return
        const now = getState().currentReads.findIndex(b => bookKey(b) === key)
        if(now !== -1) removeCurrent(now)
      })
    )

    if(series){
      actions.appendChild(el('button', {
        type: 'button',
        className: 'btn series-detach',
        onClick: async () => {
          const ok = await askConfirm({
            title: `Stop treating “${book.seriesName}” as a series?`,
            body: `You keep “${book.title}” and everything in your record.\n\n` +
                  'Finishing it just won’t hand you the next volume.',
            confirm: 'Stop the series'
          })
          if(ok) detachSeries(book.seriesKey)
        }
      }, 'Stop series'))
    }

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

  function render(state){
    const books = state.currentReads
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', books.length > 0)
    books.forEach((book, idx) => list.appendChild(entry(book, idx, books.length)))
    restoreFocus()
  }

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
