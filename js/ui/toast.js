// A brief line confirming something happened somewhere you can't see.
//
// It exists for actions whose whole result is off-screen: tapping "Read again"
// in the record puts a book on the TBR pile, and without a word here the tap
// looks like it did nothing at all.
//
// It is not an undo, and not a notification queue. One line, one message, gone
// on its own. Anything that needs a decision belongs in a modal, and anything
// worth keeping belongs on the shelf.
const LIFETIME = 2600

let host = null
let timer = null

function ensureHost(){
  if(host && host.isConnected) return host
  host = document.createElement('div')
  host.className = 'toast'
  // Polite, not assertive: this confirms something the reader just chose to do,
  // so it should wait its turn rather than interrupt what's being read out.
  host.setAttribute('role', 'status')
  host.setAttribute('aria-live', 'polite')
  host.hidden = true
  document.body.appendChild(host)
  return host
}

export function toast(message){
  if(!message) return
  const node = ensureHost()

  // A second toast replaces the first rather than stacking. Two of these on
  // screen at once would be a queue, and a queue is a thing to manage.
  clearTimeout(timer)

  // Emptying first makes a repeat of the same message announce again — without
  // it, tapping "Read again" twice would leave a screen reader silent the
  // second time, because the live region's text never changed.
  node.textContent = ''
  node.hidden = false
  node.textContent = message
  node.classList.add('showing')

  timer = setTimeout(() => {
    node.classList.remove('showing')
    // Stays in the DOM through the fade, then goes hidden so it can never be
    // reached by tab or read out as stale text.
    timer = setTimeout(() => { node.hidden = true }, 200)
  }, LIFETIME)
}
