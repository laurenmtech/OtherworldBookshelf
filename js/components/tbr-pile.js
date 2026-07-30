// The TBR pile: what's next, sorted by title.
import { el, iconButton, escapeHtml } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { bookKey } from '../services/books.js'
import {
  libbySearchUrl, libbyTitleUrl, bookshopUrl,
  cachedAvailability, requestAvailability, AVAILABILITY
} from '../services/libby.js'
import { subtitle, tagRow } from '../ui/book-meta.js'
import { subscribe, getState, removeTbr, makeTbrCurrent } from '../state/store.js'

// The first library with a Libby key is the primary one. A library entry with
// no key is a bookmark — a link you keep — and gets no borrow links.
export function primaryLibrary(state){
  return (state.library || []).find(l => l && l.libraryKey) || null
}

// "about 3 weeks" beats "estimated wait: 19 days". Nobody plans a reading life
// in days, and the number is an estimate anyway — precision would be a lie.
function waitText(days){
  if(days == null) return 'on hold'
  if(days <= 1) return 'about a day'
  if(days < 14) return `about ${Math.round(days / 7) || 1} week${days < 10 ? '' : 's'}`
  const weeks = Math.round(days / 7)
  if(weeks < 9) return `about ${weeks} weeks`
  return `about ${Math.round(days / 30)} months`
}

const FORMAT_WORD = { ebook: 'ebook', audiobook: 'audiobook' }

// What your library has, said plainly. Absent entirely when we don't know —
// no spinner, no error, no empty row holding space for a fact we never got.
function borrowRow(book, library, formats){
  if(!AVAILABILITY || !library || !formats.length) return ''
  const result = cachedAvailability(library.libraryKey, book, formats)
  if(result === undefined || result === null) return ''   // unasked, or no answer

  if(result.status === 'none'){
    // Neutral on purpose. We searched by title text and may simply have missed
    // it; asserting the library doesn't own a book is not ours to do.
    return `<div class="borrow-row muted">Didn’t find it at ${escapeHtml(library.name)}</div>`
  }

  const best = result.copies[0]
  const url = libbyTitleUrl(best.id)
  const fmt = FORMAT_WORD[best.format] || best.format
  const label = best.isAvailable
    ? `Available now · ${fmt}`
    : `${waitText(best.waitDays)} wait · ${fmt}`
  const cls = best.isAvailable ? 'borrow-row available' : 'borrow-row waiting'
  // The matched title is shown when it isn't what you asked for, so a wrong
  // edition is visible rather than silently wrong.
  const matched = best.title && best.title.toLowerCase() !== String(book.title).toLowerCase()
    ? `<span class="borrow-matched muted">matched “${escapeHtml(best.title)}”</span>`
    : ''
  const inner = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label)
  return `<div class="${cls}">${inner}${matched}</div>`
}

// Where else this book might come from. Ordinary links, built by string
// concatenation, independent of any availability lookup — they work whether or
// not the catalogue API is reachable, or enabled, or still exists.
//
// Bookshop.org rather than Amazon: buying a book should be able to send money
// to a shop instead of to the company trying to replace them all.
function findRow(book, library){
  const links = []
  if(library){
    const url = libbySearchUrl(library.libraryKey, book.title)
    if(url) links.push({ url, label: `Find at ${library.name}` })
  }
  const shop = bookshopUrl(book.title, book.author)
  if(shop) links.push({ url: shop, label: 'Bookshop.org' })
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
  // The prompt names where to go, so it may as well take you there.
  openShelf && openShelf.addEventListener('click', () => {
    const btn = document.getElementById('shelf-btn')
    if(btn) btn.click()
  })

  function row(book, idx, library, formats){
    // data-book-key is what "you already have this — go to it" finds.
    const li = el('li', { 'data-book-key': bookKey(book) })

    // A book set down as "not right now" keeps whatever you said about it, so
    // picking it up again comes with the note you left yourself.
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
            `${borrowRow(book, library, formats)}${findRow(book, library)}`
    }))

    const actions = el('div', { className: 'list-actions' },
      iconButton('finish', 'Set current', () => makeTbrCurrent(idx)),
      iconButton('edit', 'Edit', () => bookModal.open({ dest: 'tbr', index: idx, entry: book })),
      iconButton('trash', 'Remove', () => removeTbr(idx))
    )
    li.appendChild(left)
    li.appendChild(actions)
    return li
  }

  // Availability isn't state — it's a fact about the world that expires — so it
  // never enters the store. It arrives late, is cached for the session, and
  // triggers a plain re-render of this list and nothing else.
  let latest = null
  let pending = false

  function fetchAvailability(state, library, formats){
    if(!AVAILABILITY || !library || !formats.length) return
    for(const book of state.wishlist){
      if(cachedAvailability(library.libraryKey, book, formats) !== undefined) continue
      requestAvailability(library.libraryKey, book, formats).then(() => {
        // Coalesce: thirty answers landing individually would be thirty
        // re-renders of the same list.
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
    list.innerHTML = ''
    if(empty) empty.classList.toggle('hidden', state.wishlist.length > 0)
    state.wishlist.forEach((book, idx) => list.appendChild(row(book, idx, library, formats)))
    // One prompt for the pile, and only when there is a pile to prompt about.
    if(prompt) prompt.classList.toggle('hidden', !!library || state.wishlist.length === 0)
    fetchAvailability(state, library, formats)
  }

  render(getState())
  return subscribe(render)
}
