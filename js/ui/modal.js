// One implementation of modal behaviour: open, close, backdrop, Escape, focus trap,
// focus restore. Escape closes ONE layer — each open modal has its own handler, so
// without the topmost check a modal would take its parent sheet down with it.
import { trapFocus } from './dom.js'

const open = new Set()

export function isAnyModalOpen(){ return open.size > 0 }

export function hasDirtyInput(){
  return Array.from(document.querySelectorAll('input, textarea'))
    .filter(i => i.type !== 'search')
    .some(i => i.offsetParent !== null && String(i.value || '').trim() !== '')
}

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

  function onKeydown(e){
    if(e.key !== 'Escape') return
    if(Array.from(open).pop() !== el) return
    e.preventDefault()
    close()
  }

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

  el.addEventListener('click', (e) => { if(e.target === el) close() })

  return { open: openModal, close }
}
