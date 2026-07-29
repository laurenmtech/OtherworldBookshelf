// Add / edit a saved place — a library, or a bookshop. One implementation,
// two instances; the titles and the store actions are all that differ.
//
// Fields are found by data attribute rather than id so the same code can drive
// two dialogs that must still have unique ids in the document.
import { createModal } from '../../ui/modal.js'

export function mountPlaceModal(root, { addTitle, editTitle, onAdd, onEdit } = {}){
  if(!root) return { open(){} }
  const form = root.querySelector('form')
  const heading = root.querySelector('[data-place-title]')
  const nameInput = root.querySelector('[data-place-name]')
  const urlInput = root.querySelector('[data-place-url]')
  const cancelBtn = root.querySelector('[data-place-cancel]')

  let editIndex = null

  const modal = createModal(root, { onClose(){ editIndex = null } })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = nameInput.value.trim()
    if(!name) return
    const entry = { name, url: urlInput.value.trim() }
    if(editIndex !== null) onEdit(editIndex, entry)
    else onAdd(entry)
    modal.close()
  })

  return {
    open(index, entry){
      editIndex = (typeof index === 'number') ? index : null
      if(heading) heading.textContent = editIndex !== null ? editTitle : addTitle
      nameInput.value = (editIndex !== null && entry && entry.name) || ''
      urlInput.value = (editIndex !== null && entry && entry.url) || ''
      modal.open(nameInput)
    }
  }
}
