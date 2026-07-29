// The record: what was read, and how it felt.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { subscribe, getState, removeFinished } from '../state/store.js'
import { feelingLabel } from './modals/finish-modal.js'

export function mountFinishedList(root){
  const list = root.querySelector('#finished-list')

  function row(item, idx){
    const li = el('li')
    // Feeling label, falling back to a legacy 1-5 rating for older entries.
    const feel = feelingLabel(item.feeling) || (item.rating ? `Rated ${item.rating}` : '')
    const date = new Date(item.finishedAt).toLocaleDateString()
    const moodTags = (item.moods && item.moods.length)
      ? `<div class="mood-row">${item.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
      : ''
    const left = el('div', {
      html: `<div><strong>${escapeHtml(item.title)}</strong> <span class=muted>by ${escapeHtml(item.author || '')}</span>` +
            `<div class=muted>${escapeHtml(feel)}${feel ? ' · ' : ''}${date}</div>${moodTags}</div>`
    })

    const dropdown = el('div', { className: 'dropdown' })
    const toggle = el('button', {
      className: 'btn dropdown-toggle',
      type: 'button',
      onClick: () => dropdown.classList.toggle('open')
    }, 'Actions')
    const menu = el('div', { className: 'dropdown-menu' })

    // Legacy entries may still carry freeform notes; surface them if present.
    if(item.notes){
      menu.appendChild(el('button', {
        className: 'btn', type: 'button', onClick: () => alert(item.notes)
      }, 'Notes'))
    }
    menu.appendChild(iconButton('trash', 'Remove', () => removeFinished(idx)))

    dropdown.appendChild(toggle)
    dropdown.appendChild(menu)
    li.appendChild(left)
    li.appendChild(el('div', { className: 'list-actions' }, dropdown))
    return li
  }

  function render(state){
    list.innerHTML = ''
    state.finished.forEach((item, idx) => list.appendChild(row(item, idx)))
  }

  // Finished Books: expanded on desktop, collapsed by default on phones.
  const details = root.querySelector('.finished-details')
  const mq = window.matchMedia('(max-width:760px)')
  const syncOpen = () => { if(details) details.open = !mq.matches }
  syncOpen()
  mq.addEventListener('change', syncOpen)

  render(getState())
  return subscribe(render)
}
