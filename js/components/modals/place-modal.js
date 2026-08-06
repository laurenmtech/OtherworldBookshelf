// Add or edit a library or a bookshop. A library confirms its name back from the
// key you gave — `austin` resolves to Austin ISD, not Austin Public Library.
import { createModal } from '../../ui/modal.js'
import { lookupLibrary, parseLibraryKey, learnSearchUrl } from '../../services/libby.js'

export function mountPlaceModal(root, { addTitle, editTitle, onAdd, onEdit, library = false, shop = false } = {}){
  if(!root) return { open(){} }
  const form = root.querySelector('form')
  const heading = root.querySelector('[data-place-title]')
  const nameInput = root.querySelector('[data-place-name]')
  const urlInput = root.querySelector('[data-place-url]')
  const cancelBtn = root.querySelector('[data-place-cancel]')
  const keyInput = root.querySelector('[data-place-key]')
  const checkBtn = root.querySelector('[data-place-check]')
  const keyStatus = root.querySelector('[data-place-key-status]')
  const searchInput = root.querySelector('[data-place-search]')
  const searchStatus = root.querySelector('[data-place-search-status]')

  let editIndex = null
  let current = null
  let confirmed = null
  let checking = false

  const modal = createModal(root, {
    onClose(){ editIndex = null; confirmed = null; checking = false }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  function setStatus(text, kind){
    if(!keyStatus) return
    keyStatus.textContent = text || ''
    keyStatus.className = 'muted place-key-status' + (kind ? ' ' + kind : '')
  }

  async function check(){
    if(!keyInput || checking) return
    const raw = keyInput.value.trim()
    if(!raw){ confirmed = null; setStatus(''); return }
    const key = parseLibraryKey(raw)
    if(!key){ confirmed = null; setStatus("That doesn't look like a library key or a Libby link.", 'bad'); return }

    checking = true
    confirmed = null
    setStatus('Checking…')
    let found = null
    try{ found = await lookupLibrary(key) }catch(e){ /* aborted */ }
    checking = false
    if(root.hidden) return          // dismissed while the lookup was in flight

    if(!found){
      setStatus(`No library found for “${key}”. Check the key, or paste your Libby link.`, 'bad')
      return
    }
    confirmed = found
    setStatus(`Found ${found.name}`, 'good')
    if(nameInput && !nameInput.value.trim()) nameInput.value = found.name
  }

  checkBtn && checkBtn.addEventListener('click', check)
  keyInput && keyInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); check() }
  })
  keyInput && keyInput.addEventListener('input', () => {
    if(confirmed && parseLibraryKey(keyInput.value) !== confirmed.key){
      confirmed = null
      setStatus('')
    }
  })

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = nameInput.value.trim()
    if(!name){ nameInput.focus(); return }
    const entry = { name, url: urlInput.value.trim() }

    if(shop && searchInput){
      const learned = learnSearchUrl(searchInput.value)
      if(learned) entry.searchUrl = learned
    }

    // A key you typed is kept whether or not Check confirmed it. Confirming is
    // worth doing — `austin` is Austin ISD, not Austin Public Library — but the
    // check goes through the catalogue API, which is the optional half of
    // libby.js and is allowed to be unreachable. Dropping the key because the
    // enhancement didn't answer threw away the part that always works: the
    // borrow LINKS need nothing but the key. It also looked exactly like the
    // edit hadn't saved, because the field came back empty.
    if(library && keyInput){
      const typed = parseLibraryKey(keyInput.value)
      if(confirmed && confirmed.key === typed){
        entry.libraryKey = confirmed.key
        if(confirmed.name) entry.officialName = confirmed.name
      } else if(typed){
        entry.libraryKey = typed
        // Only carry the official name over if it still describes this key.
        if(current && current.libraryKey === typed && current.officialName){
          entry.officialName = current.officialName
        }
      }
    }

    if(editIndex !== null) onEdit(editIndex, entry)
    else onAdd(entry)
    modal.close()
  })

  return {
    open(index, entry){
      editIndex = (typeof index === 'number') ? index : null
      current = editIndex !== null ? (entry || null) : null
      confirmed = null
      setStatus('')
      if(heading) heading.textContent = editIndex !== null ? editTitle : addTitle
      nameInput.value = (editIndex !== null && entry && entry.name) || ''
      urlInput.value = (editIndex !== null && entry && entry.url) || ''
      if(keyInput) keyInput.value = (editIndex !== null && entry && entry.libraryKey) || ''
      if(searchInput){
        searchInput.value = (editIndex !== null && entry && entry.searchUrl) || ''
        if(searchStatus){
          searchStatus.textContent = (entry && entry.searchUrl)
            ? 'Books on your pile link straight to this shop.'
            : 'Search their site for any book and paste the results address here — then every book on your pile links straight to it at their shop.'
        }
      }
      if(keyInput && editIndex !== null && entry && entry.officialName){
        setStatus(`Saved as ${entry.officialName}`)
      }
      modal.open(library && editIndex === null && keyInput ? keyInput : nameInput)
    }
  }
}
