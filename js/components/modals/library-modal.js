// Add / edit a library or bookshop entry.
import { createModal } from '../../ui/modal.js'
import { addLibrary, editLibrary } from '../../state/store.js'

export function mountLibraryModal(root){
  const form = root.querySelector('#library-form')
  const heading = root.querySelector('#library-modal-title')
  const nameInput = root.querySelector('#lib-name')
  const urlInput = root.querySelector('#lib-url')
  const cancelBtn = root.querySelector('#cancel-library')

  let editIndex = null

  const modal = createModal(root, { onClose(){ editIndex = null } })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = nameInput.value.trim()
    if(!name) return
    const entry = { name, url: urlInput.value.trim() }
    if(editIndex !== null) editLibrary(editIndex, entry)
    else addLibrary(entry)
    modal.close()
  })

  return {
    open(index, entry){
      editIndex = (typeof index === 'number') ? index : null
      if(editIndex !== null){
        heading.textContent = 'Edit Library'
        nameInput.value = (entry && entry.name) || ''
        urlInput.value = (entry && entry.url) || ''
      } else {
        heading.textContent = 'Add to Library'
        nameInput.value = ''
        urlInput.value = ''
      }
      modal.open(nameInput)
    }
  }
}
