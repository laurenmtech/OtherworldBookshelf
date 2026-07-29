// One implementation of modal behaviour: open, close, backdrop click, Escape,
// focus trap, and focus restore. Previously each modal re-implemented the
// first two and had neither of the last three.
import { trapFocus } from './dom.js'

const open = new Set()

// Anything that wants to know whether it's safe to disturb the user.
export function isAnyModalOpen(){ return open.size > 0 }

// True when a visible text input anywhere has content the user would lose.
export function hasDirtyInput(){
  return Array.from(document.querySelectorAll('input, textarea'))
    .some(i => i.offsetParent !== null && String(i.value || '').trim() !== '')
}

// Wire a modal element once. Returns { open, close }.
// `el` is the full-screen backdrop; its first child is the dialog.
export function createModal(el, { onClose } = {}){
  if(!el) return { open(){}, close(){} }
  let releaseFocus = null
  let lastFocused = null

  function close(){
    if(el.hidden) return
    el.hidden = true
    open.delete(el)
    if(releaseFocus){ releaseFocus(); releaseFocus = null }
    document.removeEventListener('keydown', onKeydown)
    if(lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
    lastFocused = null
    if(onClose) onClose()
  }

  function onKeydown(e){ if(e.key === 'Escape'){ e.preventDefault(); close() } }

  function openModal(focusTarget){
    if(!el.hidden) return
    lastFocused = document.activeElement
    el.hidden = false
    open.add(el)
    releaseFocus = trapFocus(el)
    document.addEventListener('keydown', onKeydown)
    const target = focusTarget || el.querySelector('input, button')
    if(target && typeof target.focus === 'function') target.focus()
  }

  // Click the dimmed backdrop (outside the dialog) to dismiss.
  el.addEventListener('click', (e) => { if(e.target === el) close() })

  return { open: openModal, close }
}
