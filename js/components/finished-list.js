// The record: what was read, and how it felt.
//
// A flat list, newest first. No grouping: the search box and the feeling/vibe
// chips already slice this collection, and any grouping key the app currently
// has would either file a book in two places at once (vibes are multi-valued)
// or sort it by something nobody browses by. Genre would be the one worth
// grouping on, and it isn't in the data model until Phase 4's autofill.
//
// It also stops short of stats deliberately — no pace, no streaks, no books per
// month. A count is a memory, a graph is a target.
//
// Entries arrive as { item, index } because `index` is the position in
// state.finished that removeFinished() needs, and filtering would otherwise
// lose it.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey } from '../services/books.js'
import { tagRow } from '../ui/book-meta.js'
import { removeFinished } from '../state/store.js'
import { feelingLabel, SET_DOWN_LABEL } from '../state/moods.js'

// Newest first, whatever order the stored array happens to be in. Anything
// undated sinks to the bottom rather than sorting as 1970.
export function byNewest(a, b){
  const ta = Date.parse(a.item && a.item.finishedAt)
  const tb = Date.parse(b.item && b.item.finishedAt)
  if(Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if(Number.isNaN(ta)) return 1
  if(Number.isNaN(tb)) return -1
  return tb - ta
}

function row({ item, index }){
  const li = el('li', { 'data-book-key': bookKey(item) })
  // Feeling label, falling back to a raw value for states this build doesn't
  // know about yet, then to a legacy 1-5 rating for older entries.
  const feel = feelingLabel(item.feeling) || item.feeling || (item.rating ? `Rated ${item.rating}` : '')
  const parsed = Date.parse(item.finishedAt)
  const date = Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleDateString()
  const moodTags = (item.moods && item.moods.length)
    ? `<div class="mood-row">${item.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
    : ''
  // A book you stopped reading is part of the record, not a lesser version of
  // finishing one — so it's marked plainly rather than hidden or greyed out.
  const mark = item.setDown ? `<span class="set-down-tag">${escapeHtml(SET_DOWN_LABEL)}</span>` : ''
  const sub = [feel, date].filter(Boolean).map(escapeHtml).join(' · ')
  const left = el('div', { className: 'row-main' })
  const art = coverImg(item, { size: 'S', className: 'row-cover' })
  if(art) left.appendChild(art)
  left.appendChild(el('div', {
    html: `<div><strong>${escapeHtml(item.title)}</strong> <span class=muted>by ${escapeHtml(item.author || '')}</span>${mark}` +
          `<div class=muted>${sub}</div>${tagRow(item)}${moodTags}</div>`
  }))

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
  menu.appendChild(iconButton('trash', 'Remove', () => removeFinished(index)))

  dropdown.appendChild(toggle)
  dropdown.appendChild(menu)
  li.appendChild(left)
  li.appendChild(el('div', { className: 'list-actions' }, dropdown))
  return li
}

export function renderFinished(container, entries){
  if(!container) return
  container.innerHTML = ''
  const list = el('ul', { className: 'list' })
  ;[...entries].sort(byNewest).forEach(entry => list.appendChild(row(entry)))
  container.appendChild(list)
}
