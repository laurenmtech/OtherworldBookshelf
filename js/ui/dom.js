// el(), escapeHtml(), iconButton(), focus trap. escapeHtml also escapes quotes, so
// it is safe inside an attribute value and not only in text.
export function escapeHtml(s){
  if(!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function el(tag, props = {}, ...children){
  const node = document.createElement(tag)
  for(const [k, v] of Object.entries(props)){
    if(v == null) continue
    if(k === 'className') node.className = v
    else if(k === 'html') node.innerHTML = v
    else if(k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else node.setAttribute(k, v)
  }
  for(const c of children.flat()){
    if(c == null) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function iconButton(icon, label, onClick, className = 'btn'){
  const b = el('button', { type: 'button', className })
  b.innerHTML = `<svg><use href="#icon-${icon}"></use></svg>`
  b.appendChild(document.createTextNode(label))
  b.addEventListener('click', onClick)
  return b
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function trapFocus(container){
  function onKeydown(e){
    if(e.key !== 'Tab') return
    const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null)
    if(!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus() }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus() }
  }
  container.addEventListener('keydown', onKeydown)
  return () => container.removeEventListener('keydown', onKeydown)
}
