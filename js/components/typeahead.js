// The book typeahead: type three characters, get real books.
//
// Combobox semantics done properly, because this is the one control in the app
// that a keyboard and a screen reader have to agree about. The input is the
// combobox, the <ul> is its listbox, and the highlighted option is named by
// aria-activedescendant — focus never leaves the input, which is what lets you
// keep typing while arrowing through results.
//
// The network, the debounce and the request supersession all belong to
// services/books.js. This file is the list, the keys and the announcements.
import { el, escapeHtml } from '../ui/dom.js'
import { coverImg } from '../ui/cover.js'
import { createBookSearch, MIN_QUERY } from '../services/books.js'

const MESSAGES = {
  idle: '',
  short: `Keep typing — ${MIN_QUERY} characters to search.`,
  searching: 'Searching…',
  empty: 'No books found. You can add it manually.',
  offline: 'Search is offline — add it manually and it will sync later.',
  error: 'Search is unavailable right now — add it manually.'
}

// root must contain [data-typeahead-input], [data-typeahead-results] and
// [data-typeahead-status]. onPick receives a normalised book; onState receives
// the search state, which is how the modal knows to open manual entry when the
// search can't be reached.
export function mountTypeahead(root, { onPick, onState } = {}){
  if(!root) return { focus(){}, reset(){}, isOpen: () => false }

  const input = root.querySelector('[data-typeahead-input]')
  const list = root.querySelector('[data-typeahead-results]')
  const status = root.querySelector('[data-typeahead-status]')
  const listId = list.id || (list.id = 'typeahead-results')

  let results = []
  let active = -1

  const search = createBookSearch({
    onResults: (books) => { results = books; active = -1; paint() },
    onState: (s) => {
      if(status) status.textContent = MESSAGES[s] || ''
      // 'results' says how many, so the count is spoken once rather than on
      // every keystroke that returns the same list length.
      if(s === 'results' && status){
        status.textContent = `${results.length} result${results.length === 1 ? '' : 's'}.`
      }
      if(onState) onState(s)
    }
  })

  function close(){
    results = []
    active = -1
    paint()
  }

  function paint(){
    list.innerHTML = ''
    const open = results.length > 0
    list.hidden = !open
    input.setAttribute('aria-expanded', String(open))
    if(!open){ input.removeAttribute('aria-activedescendant'); return }

    results.forEach((book, i) => {
      const li = el('li', {
        className: 'typeahead-option',
        id: `${listId}-opt-${i}`,
        role: 'option',
        'aria-selected': String(i === active)
      })
      const art = coverImg(book, { size: 'S', className: 'typeahead-cover' })
      if(art) li.appendChild(art)
      const bits = [book.author, book.year].filter(Boolean).map(escapeHtml).join(' · ')
      const series = book.seriesName
        ? `<div class="typeahead-series muted">${escapeHtml(book.seriesName)}` +
          `${book.seriesPosition ? ` #${escapeHtml(String(book.seriesPosition))}` : ''}</div>`
        : ''
      li.appendChild(el('div', {
        className: 'typeahead-text',
        html: `<div class="typeahead-title">${escapeHtml(book.title)}</div>` +
              `<div class="muted">${bits}</div>${series}`
      }))
      // mousedown, not click: a click would fire after the input's blur, and by
      // then a modal that closes on blur-ish behaviour has already moved on.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i) })
      li.addEventListener('click', () => pick(i))
      list.appendChild(li)
    })

    if(active >= 0){
      input.setAttribute('aria-activedescendant', `${listId}-opt-${active}`)
      const node = list.children[active]
      if(node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  function pick(i){
    const book = results[i]
    if(!book) return
    search.cancel()
    close()
    if(onPick) onPick(book)
  }

  function move(delta){
    if(!results.length) return
    active = (active + delta + results.length) % results.length
    paint()
  }

  input.addEventListener('input', () => search.query(input.value))

  input.addEventListener('keydown', (e) => {
    if(e.key === 'ArrowDown'){ e.preventDefault(); move(1) }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); move(-1) }
    else if(e.key === 'Home' && results.length){ e.preventDefault(); active = 0; paint() }
    else if(e.key === 'End' && results.length){ e.preventDefault(); active = results.length - 1; paint() }
    else if(e.key === 'Enter'){
      // Enter with a highlighted result takes it; Enter with nothing highlighted
      // must not submit the form and silently add whatever was half-typed.
      e.preventDefault()
      if(active >= 0) pick(active)
    }
    else if(e.key === 'Escape' && results.length){
      // Dismiss the list first; a second Escape then closes the modal.
      e.stopPropagation()
      search.cancel()
      close()
    }
  })

  return {
    focus(){ input.focus() },
    isOpen: () => results.length > 0,
    reset(){
      search.cancel()
      input.value = ''
      if(status) status.textContent = ''
      close()
    }
  }
}
