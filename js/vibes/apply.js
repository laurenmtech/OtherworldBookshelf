// Applying a vibe: the attribute, the fonts, the status bar colour, and the
// local cache that lets the next cold start paint correctly on the first frame.
//
// Switching is only ever a change of custom properties. Nothing re-renders and
// nothing remounts, which is why scroll position, open panels and half-typed
// forms all survive it.
import { VIBES, DEFAULT_VIBE, getVibe } from './registry.js'
import { subscribe, getState } from '../state/store.js'

// Read by the inline boot script in index.html before any module loads, so it
// is deliberately its own key rather than a field inside the shelf JSON — the
// first paint can't afford to parse the whole document.
export const VIBE_KEY = 'otherworld_vibe'

function fontLink(){
  let link = document.getElementById('vibe-fonts')
  if(!link){
    link = document.createElement('link')
    link.id = 'vibe-fonts'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  return link
}

// A vibe's webfont is fetched only when that vibe is worn.
function loadFonts(vibe){
  const link = fontLink()
  if(link.getAttribute('href') !== vibe.fonts) link.setAttribute('href', vibe.fonts)
}

// The exception: while the picker is open you're comparing all five, so all
// five need their real faces. Fetched once, on open, and left in the document.
export function preloadAllFonts(){
  for(const vibe of VIBES){
    const id = `vibe-fonts-${vibe.id}`
    if(document.getElementById(id)) continue
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = vibe.fonts
    document.head.appendChild(link)
  }
}

export function applyVibe(id){
  const vibe = getVibe(id) || getVibe(DEFAULT_VIBE)
  document.documentElement.setAttribute('data-vibe', vibe.id)
  loadFonts(vibe)

  // So the installed app's status bar matches rather than staying the colour
  // of whichever vibe was current when the page was built.
  const meta = document.querySelector('meta[name="theme-color"]')
  if(meta) meta.setAttribute('content', vibe.theme)

  try{ localStorage.setItem(VIBE_KEY, vibe.id) }catch(e){ /* private mode */ }
  return vibe.id
}

// Keep the document wearing whatever the store says. Because the store is fed
// by Firestore too, signing in on a second device brings your vibe with you.
export function mountVibe(){
  let current = document.documentElement.getAttribute('data-vibe') || DEFAULT_VIBE
  const sync = (state) => {
    // A reader who has never chosen keeps whatever the boot script painted.
    if(!state.vibe || state.vibe === current) return
    current = applyVibe(state.vibe)
  }
  sync(getState())
  return subscribe(sync)
}
