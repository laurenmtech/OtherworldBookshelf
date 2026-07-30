// Add or edit a book — for the TBR pile and for Current Reads, which want the
// same three questions and differ only in where the answer lands.
//
// Adding is search-first: type, pick, done, one tap, fully populated. Typing it
// yourself is never further away than the button underneath the results, and it
// is what you get automatically when the search can't be reached — adding a
// book must never depend on a network.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { escapeHtml } from '../../ui/dom.js'
import { revealBook } from '../../ui/reveal.js'
import { mountTypeahead } from '../typeahead.js'
import { findExisting, bookKey, FORMATS } from '../../services/books.js'
import {
  addToTbr, editTbr, addCurrent, editCurrent, getState, CURRENT_CAP
} from '../../state/store.js'

const WHERE = {
  currentReads: "you're reading this now",
  wishlist: "it's already on your TBR pile",
  finished: "it's already in your record"
}

export function mountBookModal(root){
  const form = root.querySelector('#book-form')
  const heading = root.querySelector('#book-modal-title')
  const capNote = root.querySelector('#book-cap-note')
  const searchField = root.querySelector('#book-search-field')
  const manualToggle = root.querySelector('#manual-toggle')
  const manualFields = root.querySelector('#manual-fields')
  const titleInput = root.querySelector('#book-title')
  const authorInput = root.querySelector('#book-author')
  const formatField = root.querySelector('#format-field')
  const dupNote = root.querySelector('#book-duplicate')
  const saveBtn = root.querySelector('#save-book')
  const cancelBtn = root.querySelector('#cancel-book')

  const formats = singleSelect(root.querySelector('#format-chips'), FORMATS)

  let dest = 'tbr'          // 'tbr' | 'current'
  let editIndex = null      // null = adding, number = editing that entry
  let editing = null        // the entry being edited, so its extra fields survive
  let acknowledged = null   // a duplicate the user has been shown and may override
  let asksFormat = false    // whether the format chips are on screen this open

  const typeahead = mountTypeahead(searchField, {
    onPick: (book) => commit(book),
    // Offline, or the search is down: open the manual fields rather than leave
    // someone tapping a box that can't answer. Adding a book must never depend
    // on a network.
    onState: (s) => { if(s === 'offline' || s === 'error') showManual(false) }
  })

  const modal = createModal(root, {
    onClose(){
      editIndex = null
      editing = null
      acknowledged = null
      typeahead.reset()
      hideDuplicate()
    }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  function hideDuplicate(){
    if(!dupNote) return
    dupNote.hidden = true
    dupNote.innerHTML = ''
  }

  // Say where the book already is, and offer to go there. Returns true when the
  // add should stop; a second attempt on the same book goes through, because
  // two editions of one book is a real thing and this is a note, not a rule.
  function blockedAsDuplicate(book){
    const found = findExisting(getState(), book)
    if(!found) return false
    const key = bookKey(book)
    if(acknowledged === key) return false
    acknowledged = key

    if(dupNote){
      dupNote.innerHTML =
        `<p><strong>${escapeHtml(book.title)}</strong> — ${WHERE[found.list]}.</p>` +
        `<p class="muted">Save again to add it a second time.</p>`
      const go = document.createElement('button')
      go.type = 'button'
      go.className = 'btn'
      go.textContent = 'Go to it'
      go.addEventListener('click', () => {
        modal.close()
        revealBook(found.key, { route: found.route })
      })
      dupNote.appendChild(go)
      dupNote.hidden = false
    }
    return true
  }

  // The one place a book enters the shelf from this modal, whether it came from
  // a search result or from the two text fields. Synchronous, and it stays that
  // way: a search result already carries its genre and its series, so picking
  // one waits on nothing.
  function commit(book){
    if(editIndex === null && blockedAsDuplicate(book)) return
    const format = asksFormat ? formats.getValue() : null

    if(editIndex !== null){
      // Merge, don't replace: an edit here must not throw away the cover, the
      // work key or the series that came with the book when it was added.
      const merged = { ...editing, ...book }
      // Only when the chips were actually on screen. Clearing a format nobody
      // was shown would quietly delete it on a book edited from the TBR pile.
      if(asksFormat){
        if(format) merged.format = format
        else delete merged.format
      }
      if(dest === 'current') editCurrent(editIndex, merged)
      else editTbr(editIndex, merged)
    } else {
      const next = { ...book }
      if(format) next.format = format
      if(dest === 'current') addCurrent(next)
      else addToTbr(next)
    }
    modal.close()
  }

  function showManual(focus = true){
    if(manualFields) manualFields.hidden = false
    if(manualToggle) manualToggle.hidden = true
    if(saveBtn) saveBtn.hidden = false
    if(focus && titleInput) titleInput.focus()
  }

  manualToggle && manualToggle.addEventListener('click', () => showManual())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    // Submitting while the manual fields are still hidden means Enter in the
    // search box with nothing highlighted — that is not an instruction to add
    // an empty book.
    if(manualFields && manualFields.hidden) return
    const title = titleInput.value.trim()
    if(!title){ titleInput.focus(); return }
    commit({ title, author: authorInput.value.trim() })
  })

  // Editing what you already have is not a search: the book is chosen, and the
  // question is only what its title and author should say.
  function open({ dest: to = 'tbr', index = null, entry = null } = {}){
    dest = to
    editIndex = (typeof index === 'number') ? index : null
    editing = editIndex !== null ? (entry || null) : null
    acknowledged = null
    hideDuplicate()
    typeahead.reset()
    formats.clear()

    const isEdit = editIndex !== null
    heading.textContent = isEdit
      ? 'Edit book'
      : (dest === 'current' ? 'Start a book' : 'Add to TBR Pile')

    if(searchField) searchField.hidden = isEdit
    if(manualToggle) manualToggle.hidden = isEdit
    if(manualFields) manualFields.hidden = !isEdit
    if(saveBtn) saveBtn.hidden = !isEdit
    titleInput.value = isEdit ? (entry && entry.title) || '' : ''
    authorInput.value = isEdit ? (entry && entry.author) || '' : ''

    // Format belongs to a book you're actually reading, and only once it exists
    // — it is never part of the one tap that adds one.
    asksFormat = dest === 'current' && isEdit
    if(formatField) formatField.hidden = !asksFormat
    if(asksFormat && entry && entry.format) formats.setValue(entry.format)

    // Nothing is refused at three. Say what adding a fourth will actually do,
    // and name the book it will do it to, so the alternative — finishing one,
    // or setting one down — is a choice rather than an error message.
    const state = getState()
    if(capNote){
      const displaced = !isEdit && dest === 'current' && state.currentReads.length >= CURRENT_CAP
        ? state.currentReads[CURRENT_CAP - 1]
        : null
      capNote.hidden = !displaced
      if(displaced){
        capNote.textContent =
          `You're reading ${CURRENT_CAP} already. Adding another sets “${displaced.title}” ` +
          'back on the TBR pile — you could finish it or set it down instead.'
      }
    }

    modal.open(isEdit ? titleInput : null)
    if(!isEdit) typeahead.focus()
  }

  return { open }
}
