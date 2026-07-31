// The record: what was read, and how it felt.
//
// Newest first. Two kinds of row: a book, and a series.
//
// ── A series is one entry here too ──────────────────────────────────────────
// A series is one thing everywhere in the app, not one thing while it's being
// read and seven things afterwards. Finishing a volume joins the series entry
// already in the record rather than adding a row beside it, and the entry
// returns to the top each time.
//
// But the books inside it are still books. Each volume keeps its own finish
// date and its own feeling within the entry, and anything that COUNTS what
// you've read counts volumes — "seven books this year" is the true answer and
// it is the whole promise of the app. So the grouping is a RENDERING decision
// and never a storage one: volumes stay flat in state.finished exactly as they
// always have, and this file groups them by seriesKey at paint time. That keeps
// search, the feeling and vibe filters, removal, and the recommender's
// exclusion list all working on individual books without knowing series exist,
// and it means a wrong grouping is wrong on screen for one render rather than
// wrong in the reader's data.
//
// ── Filtering ungroups ──────────────────────────────────────────────────────
// The moment a filter or a search is on, this drops back to a flat list — one
// row per volume. Grouping is a browsing convenience; asking a question
// deserves a literal answer, and "Loved" showing a seven-volume row because one
// volume was loved would make the count disagree with the filter. See
// routes/finished.js, which decides.
//
// Entries arrive as { item, index } because `index` is the position in
// state.finished that removeFinished() needs, and filtering would otherwise
// lose it.
import { el, escapeHtml, iconButton } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey, inSeries, byVolume } from '../services/books.js'
import { tagRow, volumeLabel } from '../ui/book-meta.js'
import {
  removeFinished, readAgain, removeFinishedSeries, readAgainSeries
} from '../state/store.js'
import { feelingLabel, SET_DOWN_LABEL } from '../state/moods.js'

// Entries whose "Read again" was just tapped.
//
// It lives out here rather than on the button because readAgain() commits to
// the store, the store re-renders this whole list, and the button that was
// tapped stops existing about a millisecond later. Holding the state in the
// render is the only version that survives its own side effect.
//
// Keyed per ENTRY, not per book: re-reading is the whole point of this button,
// so the same title legitimately appears in the record more than once, and a
// book-level key would light up every copy at once. finishedAt is what tells
// two readings of one book apart, and unlike the array index it doesn't shift
// underneath a flash when some other row is removed.
const flashing = new Set()
const FLASH = 1500

function flashKey(item){ return `${bookKey(item)}|${item.finishedAt || ''}` }

// Which series rows are open. Same reason as `flashing`: a re-render destroys
// the button that was tapped, so the disclosure state can't live on the node.
const expanded = new Set()

// The last paint, so the timeout that ends a flash — or a tap on a disclosure —
// can redraw without waiting for a store change that may never come.
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

const dateOf = (item) => {
  const parsed = Date.parse(item && item.finishedAt)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleDateString()
}

// Feeling label, falling back to a raw value for states this build doesn't know
// about yet, then to a legacy 1-5 rating for older entries.
const feelOf = (item) =>
  feelingLabel(item.feeling) || item.feeling || (item.rating ? `Rated ${item.rating}` : '')

const moodTags = (item) => (item.moods && item.moods.length)
  ? `<div class="mood-row">${item.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
  : ''

// A book you stopped reading is part of the record, not a lesser version of
// finishing one — so it's marked plainly rather than hidden or greyed out.
const setDownTag = (item) => item.setDown
  ? `<span class="set-down-tag">${escapeHtml(SET_DOWN_LABEL)}</span>` : ''

// ── Rows ────────────────────────────────────────────────────────────────────

// The flash-on-tap button, shared by a book row and a series row.
//
// The pile isn't visible from here, so the button says where the book went
// rather than that something happened — "Added!" answers a question nobody was
// asking. It's also nearly the same length as "Read again", so the row holds
// still while it says it.
function readAgainButton(key, act){
  const onPile = flashing.has(key)
  return iconButton(
    onPile ? 'finish' : 'bookmark',
    onPile ? 'On the pile!' : 'Read again',
    () => {
      if(flashing.has(key)) return        // already flashing — don't stack timers
      flashing.add(key)
      act()                               // re-renders this row into its flashed state
      setTimeout(() => {
        flashing.delete(key)
        repaint && repaint()
      }, FLASH)
    },
    onPile ? 'btn read-again flashed' : 'btn read-again'
  )
}

function row({ item, index }){
  const li = el('li', { 'data-book-key': bookKey(item) })
  const sub = [feelOf(item), dateOf(item)].filter(Boolean).map(escapeHtml).join(' · ')
  const left = el('div', { className: 'row-main' })
  const art = coverImg(item, { size: 'S', className: 'row-cover' })
  if(art) left.appendChild(art)
  left.appendChild(el('div', {
    html: `<div><strong>${escapeHtml(item.title)}</strong> <span class=muted>by ${escapeHtml(item.author || '')}</span>${setDownTag(item)}` +
          `<div class=muted>${sub}</div>${tagRow(item)}${moodTags(item)}</div>`
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
  actions.appendChild(readAgainButton(flashKey(item), () => readAgain(index)))
  actions.appendChild(iconButton('trash', 'Remove', () => removeFinished(index)))

  li.appendChild(left)
  li.appendChild(actions)
  return li
}

// One volume inside an open series row. Smaller than a top-level row, and it
// carries the two things the grouping would otherwise hide — this volume's own
// date and its own feeling — plus a Remove that takes only this book.
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
  // Volume order inside, newest-first for the headline: the row is about a
  // series, but the line under the name is about the last time you touched it.
  const volumes = [...entries].sort((a, b) => byVolume(a.item, b.item))
  const newest = [...entries].sort(byNewest)[0].item
  const count = volumes.length
  const name = newest.seriesName || ''
  const open = expanded.has(key)

  const li = el('li', { className: 'series-row', 'data-series-key': key })

  const left = el('div', { className: 'row-main' })
  const art = coverImg(newest, { size: 'S', className: 'row-cover' })
  if(art) left.appendChild(art)
  const sub = [`${count} book${count === 1 ? '' : 's'}`, newest.title, dateOf(newest)]
    .filter(Boolean).map(escapeHtml).join(' · ')
  left.appendChild(el('div', {
    html: `<div><strong>${escapeHtml(name)}</strong> <span class=muted>by ${escapeHtml(newest.author || '')}</span>` +
          `<div class=muted>${sub}</div></div>`
  }))
  li.appendChild(left)

  const actions = el('div', { className: 'list-actions' })

  // The disclosure. Each volume keeps its own date and feeling inside the
  // entry, and this is where you read them.
  const toggle = iconButton(open ? 'up' : 'down', open ? 'Hide' : `Show all ${count}`, () => {
    if(open) expanded.delete(key); else expanded.add(key)
    repaint && repaint()
  })
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  toggle.setAttribute('aria-label', open ? `Hide the volumes of ${name}` : `Show all ${count} volumes of ${name}`)
  actions.appendChild(toggle)

  // Re-reading a series means reading it from the start, so the earliest volume
  // in the record goes back on the pile carrying its series fields — starting
  // it re-forms the entry and advancing works again. The record is untouched:
  // you have read it, and it is what's next, both at once.
  actions.appendChild(readAgainButton(`series|${key}|${newest.finishedAt || ''}`,
    () => readAgainSeries(key)))

  // A single control that can delete seven books has to say so first. Every
  // other Remove in the record takes one row and doesn't ask; this one takes
  // the whole series, and the count is the part worth reading.
  actions.appendChild(iconButton('trash', 'Remove', () => {
    const ok = confirm(
      `Remove all ${count} book${count === 1 ? '' : 's'} of “${name}” from your record?\n\n` +
      'This can’t be undone. Open the series and remove a single volume instead ' +
      'if that’s what you meant.'
    )
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

// ── Grouping ────────────────────────────────────────────────────────────────

// Flat entries in, rows out. A row is a book or a series; a series holding one
// volume is downgraded back to a book, because a disclosure that hides nothing
// is a control you have to open to find out there was nothing to see.
function toRows(entries){
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

// A series row sorts by its most recent volume — which is what makes the entry
// return to the top of the record each time a volume is added to it.
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

function byRowNewest(a, b){
  const ta = rowTime(a), tb = rowTime(b)
  if(Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if(Number.isNaN(ta)) return 1
  if(Number.isNaN(tb)) return -1
  return tb - ta
}

// `animate` is off for the redraw that ends a flash, or that opens a series.
// Every row is rebuilt from scratch here and the action rows carry an entrance
// animation, so a repaint nobody asked for would ripple the whole list a second
// and a half after a tap on one button.
//
// `group` is off whenever the route is filtering — see the header note.
export function renderFinished(container, entries, { animate = true, group = true } = {}){
  if(!container) return
  // Newest wins: if the route has re-rendered with different entries since,
  // ending a flash redraws that, not a stale list.
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
