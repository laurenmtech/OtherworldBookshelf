// The vibe picker: a grid of cards, each one wearing the vibe it offers.
//
// The cards are live rather than screenshots — every swatch, hairline and
// button below is the real token set for that vibe, which is why a card can
// never drift out of date with the stylesheet it advertises.
//
// Tapping one applies it to the whole app immediately. Nothing re-renders, so
// you can open this mid-scroll with a half-typed form behind it and lose
// neither. There's no Cancel because there's nothing to undo — pick another.
//
// Whether picking also LEAVES is the caller's call, because the two ways in
// want opposite things. On first run you're comparing, so tapping through all
// five has to be free. Coming from the shelf you've already decided — the cards
// wear their own vibes, so the choosing happened before the tap — and being
// held in a settings sheet afterwards just means two more taps to see it.
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

  const modal = createModal(root)
  doneBtn && doneBtn.addEventListener('click', () => modal.close())

  // Set per-open, because it differs between the two ways in. Cleared on close
  // so a first-run open can never inherit the shelf's behaviour.
  let onPick = null

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
    open({ firstRun = false, onPicked = null } = {}){
      onPick = onPicked
      // You're comparing all five now, so all five need their real faces. The
      // rest of the time only the worn vibe's font is ever fetched.
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
