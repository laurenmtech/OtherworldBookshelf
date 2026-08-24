// The record. Two kinds of row: a book, and a series.
//
// Grouping happens at PAINT TIME off seriesKey; volumes stay flat in state.finished
// so search, filters, removal and the recommender never learn series exist.
// Filtering ungroups — see routes/finished.js.
//
// `flashing` and `expanded` live at module scope because the action that sets them
// re-renders the list and destroys the button that was tapped.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { coverCache } from '../ui/cover.js'
import { bookKey, inSeries, byVolume } from '../services/book-shape.js'
import { unreadVolume } from '../services/series.js'
import { tagRow, volumeLabel } from '../ui/book-meta.js'
import { askConfirm, showMessage } from '../ui/dialog.js'
import {
  removeFinished, readAgain, removeFinishedSeries, readAgainSeries, addToTbr, getState
} from '../state/store.js'
import { feelingLabel, SET_DOWN_LABEL } from '../state/moods.js'

const flashing = new Set()
const FLASH = 1500

function flashKey(item){ return `${bookKey(item)}|${item.finishedAt || ''}` }

const expanded = new Set()

// At module scope for the same reason `expanded` and `flashing` are: there is
// one record, drawn by one exported function. Anything mounted more than once
// must own its cache instead — see coverCache().
const cover = coverCache()

let repaint = null

export function byNewest(a, b){
  const ta = Date.parse(a.item && a.item.finishedAt)
  const tb = Date.parse(b.item && b.item.finishedAt)
  if(Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if(Number.isNaN(ta)) return 1
  if(Number.isNaN(tb)) return -1
  return tb - ta
}

const dateOf = (item) => {
  const parsed = Date.parse(item && item.finishedAt)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleDateString()
}

const feelOf = (item) =>
  feelingLabel(item.feeling) || item.feeling || (item.rating ? `Rated ${item.rating}` : '')

const moodTags = (item) => (item.moods && item.moods.length)
  ? `<div class="mood-row">${item.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
  : ''

const setDownTag = (item) => item.setDown
  ? `<span class="set-down-tag">${escapeHtml(SET_DOWN_LABEL)}</span>` : ''

// A button that says what it did for a moment and then goes back to itself. The
// act() re-renders the row and destroys this very button, which is why `flashing`
// is at module scope and why the flashed state is read from it rather than held
// here.
function flashButton(key, { icon, label, act, className }){
  const onPile = flashing.has(key)
  return iconButton(
    onPile ? 'finish' : icon,
    onPile ? 'On the pile!' : label,
    () => {
      if(flashing.has(key)) return        // already flashing — don't stack timers
      flashing.add(key)
      act()                               // re-renders this row into its flashed state
      setTimeout(() => {
        flashing.delete(key)
        repaint && repaint()
      }, FLASH)
    },
    onPile ? `btn ${className} flashed` : `btn ${className}`
  )
}

const readAgainButton = (key, act) =>
  flashButton(key, { icon: 'bookmark', label: 'Read again', act, className: 'read-again' })

// The record's second and last chance at the announcement.
//
// A series normally announces itself in the finish modal, and that is where a
// reader corrects it. A book that only learned its series afterwards — see
// services/series-backfill.js — is past that moment with nothing ever said, so
// the row says it instead: the next volume by name, and one tap to put it on
// the pile. It is an offer and nothing more; nothing is added unasked.
//
// The flash key is the ROW's, not the volume's, because adding the volume is
// exactly what makes unreadVolume() return null — the button has to survive its
// own success long enough to say "On the pile!".
function nextUpButton(rowKey, next){
  return flashButton(`next|${rowKey}`, {
    icon: 'bookmark',
    label: 'Add to pile',
    act: () => { if(next) addToTbr(next) },
    className: 'next-up-btn'
  })
}

function nextUpOf(item){
  return inSeries(item) ? unreadVolume(item, getState()) : null
}

const nextUpLine = (next) => next
  ? `<div class="muted next-up">Next: ${escapeHtml(next.title)}</div>` : ''

function row({ item, index }){
  const li = el('li', { 'data-book-key': bookKey(item) })
  // A lone volume of a series renders here rather than as a series row — see
  // toRows() — so this is the only place it can say which volume it is.
  const sub = [volumeLabel(item), feelOf(item), dateOf(item)]
    .filter(Boolean).map(escapeHtml).join(' · ')
  const next = nextUpOf(item)
  const left = el('div', { className: 'row-main' })
  const art = cover(item, { size: 'S', className: 'row-cover' })
  if(art) left.appendChild(art)
  left.appendChild(el('div', {
    html: `<div><strong>${escapeHtml(item.title)}</strong> <span class=muted>by ${escapeHtml(item.author || '')}</span>${setDownTag(item)}` +
          `<div class=muted>${sub}</div>${nextUpLine(next)}${tagRow(item)}${moodTags(item)}</div>`
  }))

  const actions = el('div', { className: 'list-actions' })
  const nextKey = bookKey(item)
  if(next || flashing.has(`next|${nextKey}`)) actions.appendChild(nextUpButton(nextKey, next))

  if(item.notes){
    actions.appendChild(el('button', {
      className: 'btn', type: 'button',
      onClick: () => showMessage({ title: item.title, body: item.notes })
    }, 'Notes'))
  }
  actions.appendChild(readAgainButton(flashKey(item), () => readAgain(index)))
  actions.appendChild(iconButton('trash', 'Remove', () => removeFinished(index)))

  li.appendChild(left)
  li.appendChild(actions)
  return li
}

function volumeRow({ item, index }){
  const li = el('li', { className: 'series-volume-row', 'data-book-key': bookKey(item) })
  const sub = [volumeLabel(item), feelOf(item), dateOf(item)]
    .filter(Boolean).map(escapeHtml).join(' · ')
  li.appendChild(el('div', {
    className: 'small-meta',
    html: `<div><strong>${escapeHtml(item.title)}</strong>${setDownTag(item)}` +
          `<div class=muted>${sub}</div>${moodTags(item)}</div>`
  }))
  li.appendChild(el('div', { className: 'list-actions' },
    iconButton('trash', 'Remove', () => removeFinished(index))
  ))
  return li
}

function seriesRow(group){
  const { key, entries } = group
  const volumes = [...entries].sort((a, b) => byVolume(a.item, b.item))
  const newest = [...entries].sort(byNewest)[0].item
  const count = volumes.length
  const name = newest.seriesName || ''
  const open = expanded.has(key)

  const li = el('li', { className: 'series-row', 'data-series-key': key })

  const left = el('div', { className: 'row-main' })
  const art = cover(newest, { size: 'S', className: 'row-cover' })
  if(art) left.appendChild(art)
  const sub = [`${count} book${count === 1 ? '' : 's'}`, newest.title, dateOf(newest)]
    .filter(Boolean).map(escapeHtml).join(' · ')
  // Asked of the volume furthest ALONG the series rather than the most recently
  // finished one: those are the same book for a reader going in order, and when
  // they aren't, the one further on is the one that knows what is still unread.
  const next = nextUpOf(volumes[volumes.length - 1].item)
  left.appendChild(el('div', {
    html: `<div><strong>${escapeHtml(name)}</strong> <span class=muted>by ${escapeHtml(newest.author || '')}</span>` +
          `<div class=muted>${sub}</div>${nextUpLine(next)}</div>`
  }))
  li.appendChild(left)

  const actions = el('div', { className: 'list-actions' })
  if(next || flashing.has(`next|series|${key}`)) actions.appendChild(nextUpButton(`series|${key}`, next))

  const toggle = iconButton(open ? 'up' : 'down', open ? 'Hide' : `Show all ${count}`, () => {
    if(open) expanded.delete(key); else expanded.add(key)
    repaint && repaint()
  })
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  toggle.setAttribute('aria-label', open ? `Hide the volumes of ${name}` : `Show all ${count} volumes of ${name}`)
  actions.appendChild(toggle)

  actions.appendChild(readAgainButton(`series|${key}|${newest.finishedAt || ''}`,
    () => readAgainSeries(key)))

  actions.appendChild(iconButton('trash', 'Remove', async () => {
    const ok = await askConfirm({
      title: `Remove all ${count} book${count === 1 ? '' : 's'} of “${name}”?`,
      body: 'This can’t be undone.\n\n' +
            'Open the series and remove a single volume instead if that’s what you meant.',
      confirm: `Remove ${count} books`,
      danger: true
    })
    if(ok) removeFinishedSeries(key)
  }))
  li.appendChild(actions)

  if(open){
    const inner = el('ul', { className: 'series-volumes' })
    volumes.forEach(entry => inner.appendChild(volumeRow(entry)))
    li.appendChild(inner)
  }

  return li
}

// Exported so the grouping rules can be tested without a DOM. Pure by design:
// flat entries in, rows out.
export function toRows(entries){
  const rows = []
  const groups = new Map()
  for(const entry of entries){
    if(!inSeries(entry.item)){ rows.push({ kind: 'book', entry }); continue }
    const key = entry.item.seriesKey
    let group = groups.get(key)
    if(!group){
      group = { kind: 'series', key, entries: [] }
      groups.set(key, group)
      rows.push(group)
    }
    group.entries.push(entry)
  }
  return rows.map(r =>
    (r.kind === 'series' && r.entries.length === 1) ? { kind: 'book', entry: r.entries[0] } : r)
}

function rowTime(row){
  const items = row.kind === 'series' ? row.entries : [row.entry]
  let best = NaN
  for(const e of items){
    const t = Date.parse(e.item && e.item.finishedAt)
    if(Number.isNaN(t)) continue
    if(Number.isNaN(best) || t > best) best = t
  }
  return best
}

export function byRowNewest(a, b){
  const ta = rowTime(a), tb = rowTime(b)
  if(Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if(Number.isNaN(ta)) return 1
  if(Number.isNaN(tb)) return -1
  return tb - ta
}

export function renderFinished(container, entries, { animate = true, group = true } = {}){
  if(!container) return
  repaint = () => renderFinished(container, entries, { animate: false, group })
  container.innerHTML = ''
  const list = el('ul', { className: animate ? 'list' : 'list no-entrance' })
  const rows = group ? toRows(entries) : entries.map(entry => ({ kind: 'book', entry }))
  rows.sort(byRowNewest)
  for(const r of rows){
    list.appendChild(r.kind === 'series' ? seriesRow(r) : row(r.entry))
  }
  container.appendChild(list)
}
