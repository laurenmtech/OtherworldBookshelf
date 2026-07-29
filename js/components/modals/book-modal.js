// Add / edit a book on the TBR pile.
import { createModal } from '../../ui/modal.js'
import { addToTbr, editTbr } from '../../state/store.js'

export function mountBookModal(root){
  const form = root.querySelector('#wishlist-form')
  const heading = root.querySelector('#wishlist-modal-title')
  const titleInput = root.querySelector('#wish-title')
  const authorInput = root.querySelector('#wish-author')
  const cancelBtn = root.querySelector('#cancel-wish')

  let editIndex = null // null = adding, number = editing that entry

  const modal = createModal(root, { onClose(){ editIndex = null } })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = titleInput.value.trim()
    if(!title) return
    const book = { title, author: authorInput.value.trim() }
    if(editIndex !== null) editTbr(editIndex, book)
    else addToTbr(book)
    modal.close()
  })

  return {
    open(index, entry){
      editIndex = (typeof index === 'number') ? index : null
      if(editIndex !== null){
        heading.textContent = 'Edit Book'
        titleInput.value = (entry && entry.title) || ''
        authorInput.value = (entry && entry.author) || ''
      } else {
        heading.textContent = 'Add to TBR Pile'
        titleInput.value = ''
        authorInput.value = ''
      }
      modal.open(titleInput)
    }
  }
}
