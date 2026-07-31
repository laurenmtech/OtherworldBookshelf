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
import { removeFinished, readAgain } from '../state/store.js'
import { feelingLabel, SET_DOWN_LABEL } from '../state/moods.js'

// Books whose "Read again" was just tapped, by book key.
//
// It lives out here rather than on the button because readAgain() commits to
// the store, the store re-renders this whole list, and the button that was
// tapped stops existing about a millisecond later. Holding the state in the
// render is the only version that survives its own side effect.
const flashing = new Set()
const FLASH = 1500

// The last paint, so the timeout that ends a flash can redraw without waiting
// for a store change that may never come.
let repaint = null

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

  // Two buttons, shown plainly, the way every other row in the app shows them.
  // A menu labelled "Actions" is a menu that makes you open it to find out
  // there was nothing worth hiding.
  const actions = el('div', { className: 'list-actions' })

  // Legacy entries may still carry freeform notes; surface them if present.
  if(item.notes){
    actions.appendChild(el('button', {
      className: 'btn', type: 'button', onClick: () => alert(item.notes)
    }, 'Notes'))
  }
  // Puts a clean copy on the pile and leaves this entry untouched — a re-read
  // is a book you've read AND a book that's next, and the record shouldn't
  // quietly lose a year of reading to make the sentence simpler.
  // The book lands on a pile you can't see from here, so the button says so
  // itself for a moment. Nothing else on screen changes, and without a word
  // the tap reads as having done nothing at all.
  const key = bookKey(item)
  const added = flashing.has(key)
  const again = iconButton(added ? 'finish' : 'bookmark', added ? 'Added!' : 'Read again', () => {
    if(flashing.has(key)) return          // already flashing — don't stack timers
    flashing.add(key)
    readAgain(index)                      // re-renders this row into its Added! state
    setTimeout(() => {
      flashing.delete(key)
      repaint && repaint()
    }, FLASH)
  })
  if(added) again.classList.add('flashed')
  actions.appendChild(again)
  actions.appendChild(iconButton('trash', 'Remove', () => removeFinished(index)))

  li.appendChild(left)
  li.appendChild(actions)
  return li
}

export function renderFinished(container, entries){
  if(!container) return
  // Newest wins: if the route has re-rendered with different entries since,
  // ending a flash redraws that, not a stale list.
  repaint = () => renderFinished(container, entries)
  container.innerHTML = ''
  const list = el('ul', { className: 'list' })
  ;[...entries].sort(byNewest).forEach(entry => list.appendChild(row(entry)))
  container.appendChild(list)
}
