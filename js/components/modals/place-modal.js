// Add / edit a saved place — a library, or a bookshop. One implementation,
// two instances; the titles, the store actions and whether it asks about Libby
// are all that differ.
//
// Fields are found by data attribute rather than id so the same code can drive
// two dialogs that must still have unique ids in the document.
import { createModal } from '../../ui/modal.js'
import { lookupLibrary, parseLibraryKey, learnSearchUrl } from '../../services/libby.js'

// library:true adds the Libby lookup — the key field and the confirmation.
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
  // The entry being edited, so an unchanged key survives a rename untouched.
  let current = null
  // The confirmed library, if one has been looked up this time round. Holding
  // it separately from the field is what makes "typed something, didn't check
  // it" distinguishable from "confirmed this library".
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

  // Confirming is the whole point of this field: it turns a silent wrong guess
  // into a visible one. Type "austin" and it says Austin ISD, which is not the
  // library you meant. See lookupLibrary() for why searching by name isn't an
  // option.
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
    // Prefill the label with the official name, then get out of the way — it's
    // yours to rename to "Mom's card" or "the good one".
    if(nameInput && !nameInput.value.trim()) nameInput.value = found.name
  }

  checkBtn && checkBtn.addEventListener('click', check)
  keyInput && keyInput.addEventListener('keydown', (e) => {
    // Enter here means "check this", not "save the place".
    if(e.key === 'Enter'){ e.preventDefault(); check() }
  })
  keyInput && keyInput.addEventListener('input', () => {
    // Editing the field invalidates whatever was confirmed for the old value.
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

    // Optional: a shop that teaches us its search URL gets deep links to every
    // book on the pile. See learnSearchUrl().
    if(shop && searchInput){
      const learned = learnSearchUrl(searchInput.value)
      if(learned) entry.searchUrl = learned
    }

    // A library keeps its key and its official name; a plain bookmark keeps
    // neither, and that absence is what "this one gets no availability" means.
    //
    // Renaming must never touch the key, which is why the saved one is carried
    // forward whenever the field still holds it — you can retitle "King County
    // Library System" to "the good one" without re-confirming anything.
    if(library && keyInput){
      const typed = parseLibraryKey(keyInput.value)
      if(confirmed){
        entry.libraryKey = confirmed.key
        if(confirmed.name) entry.officialName = confirmed.name
      } else if(current && current.libraryKey && typed === current.libraryKey){
        entry.libraryKey = current.libraryKey
        if(current.officialName) entry.officialName = current.officialName
      }
      // Anything else — cleared, or typed and never confirmed — saves as a
      // plain bookmark rather than as a library we can't actually reach.
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
