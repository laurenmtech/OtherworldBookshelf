// The TBR pile: what's next, sorted by title. Availability is never state — it's a
// fact about the world that expires, so it's cached for the session only.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey } from '../services/book-shape.js'
import {
  libbySearchUrl, libbyTitleUrl, bookshopUrl, shopSearchUrl,
  cachedAvailability, requestAvailability, AVAILABILITY
} from '../services/libby.js'
import { subtitle, tagRow } from '../ui/book-meta.js'
import { entranceGuard } from '../ui/entrance.js'
import { subscribe, getState, removeTbr, makeTbrCurrent } from '../state/store.js'

export function primaryLibrary(state){
  return (state.library || []).find(l => l && l.libraryKey) || null
}

export function primaryShop(state){
  return (state.bookstores || [])[0] || null
}

function waitText(days){
  if(days == null) return 'on hold'
  if(days <= 1) return 'about a day'
  if(days < 14) return `about ${Math.round(days / 7) || 1} week${days < 10 ? '' : 's'}`
  const weeks = Math.round(days / 7)
  if(weeks < 9) return `about ${weeks} weeks`
  return `about ${Math.round(days / 30)} months`
}

const FORMAT_WORD = { ebook: 'ebook', audiobook: 'audiobook' }

function exactLibbyUrl(book, library, formats){
  if(!AVAILABILITY || !library || !formats.length) return null
  const result = cachedAvailability(library.libraryKey, book, formats)
  if(!result || result.status === 'none' || !result.copies || !result.copies.length) return null
  return libbyTitleUrl(result.copies[0].id) || null
}

function borrowRow(book, library, formats){
  if(!AVAILABILITY || !library || !formats.length) return ''
  const result = cachedAvailability(library.libraryKey, book, formats)
  if(result === undefined || result === null) return ''   // unasked, or no answer

  if(result.status === 'none'){
    return `<div class="borrow-row muted">Didn’t find it at ${escapeHtml(library.name)}</div>`
  }

  const best = result.copies[0]
  const fmt = FORMAT_WORD[best.format] || best.format
  const label = best.isAvailable
    ? `Available now · ${fmt}`
    : `${waitText(best.waitDays)} wait · ${fmt}`
  const cls = best.isAvailable ? 'borrow-row available' : 'borrow-row waiting'
  const matched = best.title && best.title.toLowerCase() !== String(book.title).toLowerCase()
    ? `<span class="borrow-matched muted">matched “${escapeHtml(best.title)}”</span>`
    : ''
  return `<div class="${cls}">${escapeHtml(label)}${matched}</div>`
}

function findRow(book, library, shop, want, formats){
  const links = []
  if(want.includes('library') && library){
    const url = exactLibbyUrl(book, library, formats) || libbySearchUrl(library.libraryKey, book.title)
    if(url) links.push({ url, label: `Checkout at ${library.name}` })
  }
  if(want.includes('shop')){
    const url = shop ? shopSearchUrl(shop, book.title, book.author)
                     : bookshopUrl(book.title, book.author)
    if(url) links.push({ url, label: `Checkout at ${shop ? shop.name : 'Bookshop.org'}` })
  }
  if(!links.length) return ''
  return `<div class="find-row">${links.map(l =>
    `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`
  ).join('')}</div>`
}

export function mountTbrPile(root, { bookModal }){
  const list = root.querySelector('#wishlist')
  const empty = root.querySelector('#wishlist-empty')
  const addBtn = root.querySelector('#add-wish-btn')
  const prompt = root.querySelector('#tbr-library-prompt')
  const openShelf = root.querySelector('#tbr-open-shelf')

  addBtn && addBtn.addEventListener('click', () => bookModal.open({ dest: 'tbr' }))
  const emptyAction = empty && empty.querySelector('[data-empty-action]')
  emptyAction && emptyAction.addEventListener('click', () => bookModal.open({ dest: 'tbr' }))
  openShelf && openShelf.addEventListener('click', () => {
    const btn = document.getElementById('shelf-btn')
    if(btn) btn.click()
  })

  function row(book, idx, library, formats, shop, want){
    const li = el('li', { 'data-book-key': bookKey(book) })

    const moodTags = (book.moods && book.moods.length)
      ? `<div class="mood-row">${book.moods.map(m => `<span class="mood-tag">${escapeHtml(m)}</span>`).join('')}</div>`
      : ''
    const bits = subtitle(book).map(escapeHtml).join(' · ')
    const left = el('div', { className: 'row-main' })
    const art = coverImg(book, { size: 'S', className: 'row-cover' })
    if(art) left.appendChild(art)
    left.appendChild(el('div', {
      className: 'small-meta',
      html: `<span class="wishlist-title">${escapeHtml(book.title)}</span>` +
            `<div class=muted>${bits}</div>${tagRow(book)}${moodTags}` +
            `${borrowRow(book, library, formats)}${findRow(book, library, shop, want, formats)}`
    }))

    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Set current', () => makeTbrCurrent(idx)),
      iconButton('trash', 'Remove', () => removeTbr(idx))
    )
    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  let latest = null
  let pending = false
  // Availability answers redraw the whole pile (see fetchAvailability) and none
  // of those redraws add a book, so none of them should replay the entrance.
  const isNews = entranceGuard()

  function fetchAvailability(state, library, formats){
    if(!AVAILABILITY || !library || !formats.length) return
    for(const book of state.wishlist){
      if(cachedAvailability(library.libraryKey, book, formats) !== undefined) continue
      requestAvailability(library.libraryKey, book, formats).then(() => {
        if(pending) return
        pending = true
        setTimeout(() => { pending = false; if(latest) render(latest) }, 60)
      })
    }
  }

  function render(state){
    latest = state
    const library = primaryLibrary(state)
    const formats = state.borrowFormats || []
    const shop = primaryShop(state)
    const want = state.findLinks || []
    list.classList.toggle('no-entrance', !isNews(state.wishlist.map(bookKey)))
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', state.wishlist.length > 0)
    state.wishlist.forEach((book, idx) => list.appendChild(row(book, idx, library, formats, shop, want)))
    if(prompt) prompt.classList.toggle('hidden',
      !!library || state.wishlist.length === 0 || !want.includes('library'))
    fetchAvailability(state, library, formats)
  }

  render(getState())
  return subscribe(render)
}
