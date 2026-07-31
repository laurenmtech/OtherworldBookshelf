// Bottom-sheet behaviour, built on modal.js.
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

  window.addEventListener('hashchange', () => modal.close())

  return { open, close: modal.close }
}
