// Take someone to a book they already have.
//
// "You've already got this one" is only half an answer; the other half is
// showing them where. Every row that renders a book stamps data-book-key (see
// bookKey() in services/books.js), so this can find one without any list having
// to expose its internals.

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

// Switches tab if needed, then looks for the row across the next few frames —
// the route it's on may not have rendered yet at the moment of asking.
export function revealBook(key, { route = '/' } = {}){
  if(!key) return
  if(location.hash.replace(/^#/, '') !== route) location.hash = `#${route}`

  let tries = 0
  const attempt = () => {
    const node = find(key)
    if(node) return show(node)
    // On Finished, a filter or a search term can be hiding it. Clearing them is
    // exactly what the visible control does, so use that rather than reaching
    // into the route's state.
    const clear = document.getElementById('clear-filters')
    if(tries === 0 && clear && !clear.hidden) clear.click()
    if(++tries < 4) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}
