// Asking a question, and saying something — in the app's own voice. Replaces
// confirm() and alert().
//
// confirm() BLOCKED; these return a promise. A caller must not carry an array
// index across the await — re-resolve by bookKey. See ARCHITECTURE.md > Invariants.
import { el } from './dom.js'
import { createModal } from './modal.js'

function paragraphs(body){
  return String(body || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
}

function dialog({ title, body, buttons, initial }){
  return new Promise(resolve => {
    const root = el('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true' })
    const inner = el('div', { className: 'finish-inner dialog-inner' })

    const heading = el('h3', {}, title)
    const id = `dialog-title-${Math.random().toString(36).slice(2, 8)}`
    heading.id = id
    root.setAttribute('aria-labelledby', id)
    inner.appendChild(heading)
    for(const p of paragraphs(body)) inner.appendChild(el('p', { className: 'muted' }, p))

    let answered = null
    const modal = createModal(root, {
      onClose(){
        root.remove()
        resolve(answered === null ? buttons.find(b => b.safe).value : answered)
      }
    })

    const actions = el('div', { className: 'actions' })
    let focusMe = null
    for(const b of buttons){
      const button = el('button', {
        type: 'button',
        className: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
        onClick: () => { answered = b.value; modal.close() }
      }, b.label)
      if(b.focus) focusMe = button
      actions.appendChild(button)
    }
    inner.appendChild(actions)
    root.appendChild(inner)
    document.body.appendChild(root)
    modal.open(focusMe)
  })
}

export function askConfirm({ title, body = '', confirm = 'OK', cancel = 'Cancel', danger = false } = {}){
  return dialog({
    title,
    body,
    buttons: [
      { label: confirm, value: true, primary: !danger, danger },
      { label: cancel, value: false, safe: true, focus: true }
    ]
  })
}

export function showMessage({ title, body = '', close = 'Close' } = {}){
  return dialog({
    title,
    body,
    buttons: [{ label: close, value: undefined, primary: true, safe: true, focus: true }]
  })
}
