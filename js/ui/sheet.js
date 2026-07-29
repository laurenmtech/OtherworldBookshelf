// The settings sheet's own behaviour: slides up from the bottom on a phone,
// centred dialog on a wide screen.
//
// Everything it shares with the modals — Escape, backdrop click, focus trap,
// focus restore on close — comes from createModal rather than being written a
// second time here. What's left, and the reason this is its own file, is the
// part a sheet needs and a modal doesn't: locking the page behind it so the
// background doesn't scroll under your thumb, and closing itself when the route
// changes so it can never outlive the screen it was opened from.
import { createModal } from './modal.js'

export function createSheet(root, { closeSelector = '[data-sheet-close]', onClose } = {}){
  if(!root) return { open(){}, close(){} }

  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')

  const modal = createModal(root, {
    onClose(){
      document.body.classList.remove('sheet-open')
      if(onClose) onClose()
    }
  })

  root.querySelectorAll(closeSelector).forEach(btn => {
    btn.addEventListener('click', () => modal.close())
  })

  function open(){
    document.body.classList.add('sheet-open')
    modal.open()
  }

  // A sheet opened from Reading must not still be sitting there after a tab
  // change — including one caused by the back button.
  window.addEventListener('hashchange', () => modal.close())

  return { open, close: modal.close }
}
