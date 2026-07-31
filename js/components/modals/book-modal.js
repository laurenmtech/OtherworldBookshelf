// Add a book — to the pile, to Current Reads, or straight to the record.
//
// Search-first, and committing is synchronous: a search result already carries its
// genre and series. The series lookup fires AFTER the book is on the shelf and is
// never awaited — adding must not depend on a network.
import { createModal } from '../../ui/modal.js'
import { escapeHtml } from '../../ui/dom.js'
import { revealBook } from '../../ui/reveal.js'
import { mountTypeahead } from '../typeahead.js'
import { findExisting, bookKey } from '../../services/book-shape.js'
import { enrich } from '../../services/series.js'
import {
  addToTbr, addCurrent, addAlreadyRead, getState, CURRENT_CAP
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
  const dupNote = root.querySelector('#book-duplicate')
  const saveBtn = root.querySelector('#save-book')
  const cancelBtn = root.querySelector('#cancel-book')

  let dest = 'tbr'          // 'tbr' | 'current' | 'finished'
  let acknowledged = null   // a duplicate the user has been shown and may override

  const typeahead = mountTypeahead(searchField, {
    onPick: (book) => commit(book),
    onState: (s) => { if(s === 'offline' || s === 'error') showManual(false) }
  })

  const modal = createModal(root, {
    onClose(){
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

  function commit(book){
    if(blockedAsDuplicate(book)) return
    const next = { ...book }
    if(dest === 'current') addCurrent(next)
    else if(dest === 'finished') addAlreadyRead(next)
    else addToTbr(next)
    enrich(next)
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
    if(manualFields && manualFields.hidden) return
    const title = titleInput.value.trim()
    if(!title){ titleInput.focus(); return }
    commit({ title, author: authorInput.value.trim() })
  })

  function open({ dest: to = 'tbr' } = {}){
    dest = to
    acknowledged = null
    hideDuplicate()
    typeahead.reset()

    heading.textContent =
      dest === 'current' ? 'Start a book'
      : dest === 'finished' ? 'Add a book you’ve read'
      : 'Add to TBR Pile'

    if(searchField) searchField.hidden = false
    if(manualToggle) manualToggle.hidden = false
    if(manualFields) manualFields.hidden = true
    if(saveBtn) saveBtn.hidden = true
    titleInput.value = ''
    authorInput.value = ''

    const state = getState()
    if(capNote){
      const displaced = dest === 'current' && state.currentReads.length >= CURRENT_CAP
        ? state.currentReads[CURRENT_CAP - 1]
        : null
      capNote.hidden = !displaced
      if(displaced){
        capNote.textContent =
          `You're reading ${CURRENT_CAP} already. Adding another sets “${displaced.title}” ` +
          'back on the TBR pile — you could finish it or set it down instead.'
      }
    }

    modal.open(null)
    typeahead.focus()
  }

  return { open }
}
