// The Current Read card: the entry form when empty, the book when set.
// Stored as a list (currentReads) since Phase 1; only the first entry is
// rendered until Phase 3 brings the list UI.
import { subscribe, getState, addCurrent, editCurrent } from '../state/store.js'

export function mountCurrentReads(root, { finishModal }){
  // The same form both starts a book and edits the one in progress. Which it
  // is matters: addCurrent now sets a displaced book down on the TBR pile, so
  // correcting a typo through it would file the misspelling as something to
  // read next.
  let editing = false
  const form = root.querySelector('#current-form')
  const titleInput = root.querySelector('#current-title')
  const authorInput = root.querySelector('#current-author')
  const finishBtn = root.querySelector('#finish-current')
  const display = root.querySelector('#current-display')
  const displayTitle = root.querySelector('#display-title')
  const displayAuthor = root.querySelector('#display-author')
  const editBtn = root.querySelector('#edit-current')
  const finishDisplayBtn = root.querySelector('#finish-current-display')

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = titleInput.value.trim()
    if(!title) return alert('Please enter a title')
    const book = { title, author: authorInput.value.trim() }
    if(editing && getState().currentReads[0]) editCurrent(0, book)
    else addCurrent(book)
    editing = false
  })

  editBtn && editBtn.addEventListener('click', () => {
    const book = getState().currentReads[0]
    if(!book) return
    editing = true
    titleInput.value = book.title || ''
    authorInput.value = book.author || ''
    form.classList.remove('hidden')
    display.classList.add('hidden')
  })

  const openFinish = () => {
    if(!getState().currentReads[0]) return alert('No current book to finish')
    finishModal.open(0)
  }
  finishDisplayBtn && finishDisplayBtn.addEventListener('click', openFinish)
  finishBtn && finishBtn.addEventListener('click', openFinish)

  function render(state){
    const book = state.currentReads[0]
    if(book){
      form.classList.add('hidden')
      display.classList.remove('hidden')
      displayTitle.textContent = book.title
      displayAuthor.textContent = book.author || ''
    } else {
      form.classList.remove('hidden')
      display.classList.add('hidden')
      titleInput.value = ''
      authorInput.value = ''
      editing = false   // empty form is always "start a book", never an edit
    }
  }

  render(getState())
  return subscribe(render)
}
