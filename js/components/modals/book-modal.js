// Add a book — to the TBR pile, to Current Reads, or straight to the record for
// something read before this app existed. Three destinations, same three
// questions, differing only in where the answer lands.
//
// Adding is search-first: type, pick, done, one tap, fully populated. Typing it
// yourself is never further away than the button underneath the results, and it
// is what you get automatically when the search can't be reached — adding a
// book must never depend on a network.
//
// There is no edit. Books arrive from a real catalogue with their own title,
// author, cover and series, so the thing you'd have edited is usually already
// right — and when it isn't, the honest fix is to remove it and search again
// rather than to hand-correct a record that's meant to mirror a real book.
import { createModal } from '../../ui/modal.js'
import { escapeHtml } from '../../ui/dom.js'
import { revealBook } from '../../ui/reveal.js'
import { mountTypeahead } from '../typeahead.js'
import { findExisting, bookKey } from '../../services/books.js'
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
    // Offline, or the search is down: open the manual fields rather than leave
    // someone tapping a box that can't answer. Adding a book must never depend
    // on a network.
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
    if(blockedAsDuplicate(book)) return
    const next = { ...book }
    if(dest === 'current') addCurrent(next)
    // A book read before the app existed. It lands undated on purpose — see
    // addAlreadyRead — so the record never claims you finished something today
    // that you finished years ago.
    else if(dest === 'finished') addAlreadyRead(next)
    else addToTbr(next)
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

  function open({ dest: to = 'tbr' } = {}){
    dest = to
    acknowledged = null
    hideDuplicate()
    typeahead.reset()

    heading.textContent =
      dest === 'current' ? 'Start a book'
      : dest === 'finished' ? 'Add a book you’ve read'
      : 'Add to TBR Pile'

    // Always the search-first state now: the fields underneath are the fallback
    // for a book the catalogue doesn't have, not a second way in.
    if(searchField) searchField.hidden = false
    if(manualToggle) manualToggle.hidden = false
    if(manualFields) manualFields.hidden = true
    if(saveBtn) saveBtn.hidden = true
    titleInput.value = ''
    authorInput.value = ''

    // Nothing is refused at three. Say what adding a fourth will actually do,
    // and name the book it will do it to, so the alternative — finishing one,
    // or setting one down — is a choice rather than an error message.
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
