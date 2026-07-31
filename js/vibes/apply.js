// Applies a vibe: the data attribute, its webfonts, theme-color, and a local cache
// so the boot script in index.html can beat the first paint.
import { VIBES, DEFAULT_VIBE, getVibe } from './registry.js'
import { subscribe, getState } from '../state/store.js'

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

function loadFonts(vibe){
  const link = fontLink()
  if(link.getAttribute('href') !== vibe.fonts) link.setAttribute('href', vibe.fonts)
}

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

  const meta = document.querySelector('meta[name="theme-color"]')
  if(meta) meta.setAttribute('content', vibe.theme)

  try{ localStorage.setItem(VIBE_KEY, vibe.id) }catch(e){ /* private mode */ }
  return vibe.id
}

export function mountVibe(){
  let current = document.documentElement.getAttribute('data-vibe') || DEFAULT_VIBE
  const sync = (state) => {
    if(!state.vibe || state.vibe === current) return
    current = applyVibe(state.vibe)
  }
  sync(getState())
  return subscribe(sync)
}
