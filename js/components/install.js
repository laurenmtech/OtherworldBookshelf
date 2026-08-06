// Putting the app on a home screen. The manifest, the icons and the iOS title
// have been right since phase 8 — this is only the part that says so out loud.
//
// TWO PLATFORMS, TWO DIFFERENT THINGS. Chrome fires `beforeinstallprompt` and
// hands you a real installer; Safari has no such event, so iOS can only be told
// where the button is. Rather than sniff the user agent to decide which to say —
// which is wrong eventually, and silently — both sets of steps are always
// written out, and the button simply replaces them when a live prompt exists.
//
// Nothing shows at all once the app IS installed. A settings screen telling you
// to add something you already added is one you stop believing.
//
// The listeners are at module scope on purpose: `beforeinstallprompt` can fire
// before the sheet is mounted, and an event you weren't listening for is an
// install button that never appears.
let deferred = null
let installed = false
let notify = () => {}

export function isStandalone(){
  try{
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true
  }catch(e){
    return false
  }
}

if(typeof window !== 'undefined'){
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()          // keep Chrome's own infobar out of the way; ours is better placed
    deferred = e
    notify()
  })
  // Fires in the tab that installed it, which is still an ordinary tab — so
  // isStandalone() is false here and this flag is what hides the section.
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    notify()
  })
}

// A phone or a tablet — asked as a capability, not by name. A coarse pointer is
// a touchscreen, and what we actually want to know is whether there is a home
// screen to add anything to; no user-agent string answers that more honestly.
function isTouchPrimary(){
  try{ return window.matchMedia('(pointer: coarse)').matches }catch(e){ return false }
}

// Whether the welcome flow should spend one of its steps on this. A desktop
// with no installer on offer would only be reading an instruction it can't
// follow, and the Hidden Shelf section is there for it either way.
export function canOfferInstall(){
  if(installed || isStandalone()) return false
  return !!deferred || isTouchPrimary()
}

export function hasInstallPrompt(){ return !!deferred }

export async function promptInstall(){
  if(!deferred) return false
  const event = deferred
  deferred = null               // a prompt is good for exactly one use
  try{ await event.prompt() }catch(e){ /* dismissed, or already spent */ }
  notify()                      // the sheet section falls back to the written steps
  return true
}

export function mountInstall(root){
  if(!root) return
  const actions = root.querySelector('[data-install-actions]')
  const button = root.querySelector('[data-install-button]')
  const steps = root.querySelector('[data-install-steps]')

  function render(){
    if(installed || isStandalone()){ root.hidden = true; return }
    root.hidden = false
    if(actions) actions.hidden = !deferred
    if(steps) steps.hidden = !!deferred
  }

  // promptInstall() clears the event and calls notify(), which is render() —
  // so saying no brings the written steps back.
  button && button.addEventListener('click', () => promptInstall())

  notify = render
  render()
}
