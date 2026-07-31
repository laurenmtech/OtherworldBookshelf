// Scroll to a book you already have and flash it, found by data-book-key.
const FLASH_MS = 1600

function find(key){
  return Array.from(document.querySelectorAll('[data-book-key]'))
    .find(n => n.getAttribute('data-book-key') === key) || null
}

function show(node){
  node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  node.classList.add('reveal-flash')
  setTimeout(() => node.classList.remove('reveal-flash'), FLASH_MS)
}

export function revealBook(key, { route = '/' } = {}){
  if(!key) return
  if(location.hash.replace(/^#/, '') !== route) location.hash = `#${route}`

  let tries = 0
  const attempt = () => {
    const node = find(key)
    if(node) return show(node)
    const clear = document.getElementById('clear-filters')
    if(tries === 0 && clear && !clear.hidden) clear.click()
    if(++tries < 4) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}
