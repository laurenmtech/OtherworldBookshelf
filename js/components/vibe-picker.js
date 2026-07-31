// The vibe grid. Cards are LIVE — each wears the real token set it offers, so a
// card can never drift out of date with its stylesheet.
//
// Whether picking also leaves is the caller's call: on first run you're comparing.
import { el } from '../ui/dom.js'
import { createModal } from '../ui/modal.js'
import { VIBES, DEFAULT_VIBE } from '../vibes/registry.js'
import { applyVibe, preloadAllFonts } from '../vibes/apply.js'
import { setVibe, getState, subscribe } from '../state/store.js'

function miniature(){
  return el('span', { className: 'vibe-mini' },
    el('span', { className: 'vibe-mini-title' }, 'Otherworld Bookshelf'),
    el('span', { className: 'vibe-mini-panel' },
      el('span', { className: 'vibe-mini-row' },
        el('span', { className: 'vibe-mini-book' }),
        el('span', { className: 'vibe-mini-lines' },
          el('span', { className: 'vibe-mini-line' }),
          el('span', { className: 'vibe-mini-line short' })
        )
      ),
      el('span', { className: 'vibe-mini-chips' },
        el('span', { className: 'vibe-mini-chip' }, 'Loved'),
        el('span', { className: 'vibe-mini-chip' }, 'Cozy')
      )
    ),
    el('span', { className: 'vibe-mini-btn' }, 'Finish')
  )
}

export function mountVibePicker(root){
  if(!root) return { open(){} }
  const grid = root.querySelector('#vibe-grid')
  const doneBtn = root.querySelector('#vibe-done')
  const note = root.querySelector('#vibe-picker-note')

  let onPick = null
  let onDone = null

  const modal = createModal(root, {
    onClose(){
      const done = onDone
      onPick = null
      onDone = null
      if(done) done()
    }
  })
  doneBtn && doneBtn.addEventListener('click', () => modal.close())

  const cards = VIBES.map(vibe => {
    const card = el('button', {
      type: 'button',
      className: 'vibe-card vibe-scope',
      'aria-pressed': 'false',
      onClick: () => {
        applyVibe(vibe.id)   // instant, before the store round-trip
        setVibe(vibe.id)     // persisted locally and to the cloud
        if(onPick){
          const leave = onPick
          onPick = null      // one exit per open, even on a double tap
          modal.close()
          leave()
        }
      }
    },
      miniature(),
      el('span', { className: 'vibe-name' }, vibe.name),
      el('span', { className: 'vibe-blurb' }, vibe.blurb)
    )
    card.dataset.vibe = vibe.id
    grid.appendChild(card)
    return card
  })

  function paint(state){
    const active = state.vibe || document.documentElement.getAttribute('data-vibe') || DEFAULT_VIBE
    cards.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.vibe === active)))
  }
  paint(getState())
  subscribe(paint)

  return {
    open({ firstRun = false, onPicked = null, onClosed = null } = {}){
      onPick = onPicked
      onDone = onClosed
      preloadAllFonts()
      if(note){
        note.textContent = firstRun
          ? 'Pick the look of your library. You can change it whenever you like.'
          : 'Your library’s look. Pick one and you’re back with your books.'
      }
      if(doneBtn) doneBtn.textContent = firstRun ? 'Start reading' : 'Done'
      paint(getState())
      modal.open(doneBtn)
    }
  }
}
