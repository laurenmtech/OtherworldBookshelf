// "How was it?" — feeling + optional vibes, captured when a book is finished.
import { createModal } from '../../ui/modal.js'
import { singleSelect, multiSelect } from '../../ui/chips.js'
import { el } from '../../ui/dom.js'
import { finishCurrent, getState } from '../../state/store.js'

export const FEELINGS = [
  { key: 'loved', label: '💛 Loved' },
  { key: 'liked', label: 'Liked' },
  { key: 'not-for-me', label: 'Not for me' }
]

// Vibes, in three groups. The original ten were all fantasy-shaped, which left
// horror, science fiction and anything read to learn something with no words
// that fitted. Every one of those ten is still here — extending the list can't
// orphan a vibe already saved on a book.
export const MOOD_GROUPS = [
  { label: 'Atmosphere', moods: ['Cozy', 'Dark', 'Creepy', 'Dread', 'Bleak', 'Whimsical', 'Hopeful'] },
  { label: 'Story', moods: ['Epic', 'Twisty', 'Slow-burn', 'Fast-paced', 'Tense', 'Funny', 'Devastating', 'Romantic', 'Comfort-read'] },
  { label: 'Mind', moods: ['Mind-expanding', 'Mind-bending', 'Practical', 'Dense', 'Eye-opening'] }
]

// Flat, in group order — the canonical ordering the Finished filters sort by.
export const MOODS = MOOD_GROUPS.flatMap(g => g.moods)

export const feelingLabel = k => (FEELINGS.find(f => f.key === k) || {}).label

// Vibes you typed yourself are not stored in their own list: they're read back
// off the books that carry them. That means no schema change, no second place
// for the vocabulary to drift out of sync, and a list that stays honest — a
// word you used once and then removed stops being offered.
export function customMoods(finished){
  const known = new Set(MOODS)
  const seen = new Set()
  for(const item of finished || []){
    for(const m of item.moods || []) if(!known.has(m)) seen.add(m)
  }
  return Array.from(seen).sort()
}

export function mountFinishModal(root){
  const form = root.querySelector('#finish-form-inner')
  const cancelBtn = root.querySelector('#cancel-finish')
  const moodRoot = root.querySelector('#mood-groups')
  const newVibeInput = root.querySelector('#new-vibe')
  const addVibeBtn = root.querySelector('#add-vibe')

  const feelings = singleSelect(root.querySelector('#feeling-chips'), FEELINGS)

  let targetIndex = 0
  let controls = []      // one multiSelect per group
  let session = []       // vibes typed during this open, not yet saved anywhere

  const selected = () => controls.flatMap(c => c.getValue())
  // setValue keeps only the keys a group actually owns, so handing every group
  // the full selection is the whole restore.
  const restore = (values) => controls.forEach(c => c.setValue(values))

  function buildMoods(){
    if(!moodRoot) return
    const known = new Set(MOODS)
    const yours = Array.from(new Set([
      ...customMoods(getState().finished),
      ...session
    ])).filter(m => !known.has(m)).sort()

    const defs = yours.length ? [...MOOD_GROUPS, { label: 'Yours', moods: yours }] : MOOD_GROUPS

    moodRoot.innerHTML = ''
    controls = defs.map(def => {
      const chips = el('div', { className: 'chips' })
      moodRoot.appendChild(el('div', { className: 'mood-group' },
        el('div', { className: 'mood-group-label' }, def.label),
        chips
      ))
      return multiSelect(chips, def.moods)
    })
  }

  function addVibe(){
    if(!newVibeInput) return
    const name = newVibeInput.value.trim()
    if(!name) return
    const keep = selected()
    // Typing a word that already exists just selects it rather than making a
    // near-duplicate sitting in a different group.
    const match = [...MOODS, ...session].find(m => m.toLowerCase() === name.toLowerCase())
    const value = match || name
    if(!match) session.push(value)
    newVibeInput.value = ''
    buildMoods()
    restore([...keep, value])
    newVibeInput.focus()
  }

  addVibeBtn && addVibeBtn.addEventListener('click', addVibe)
  // Enter in this field means "add this vibe", not "save the book".
  newVibeInput && newVibeInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); addVibe() }
  })

  const modal = createModal(root, {
    onClose(){ feelings.clear(); restore([]) }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    finishCurrent(targetIndex, { feeling: feelings.getValue(), moods: selected() })
    modal.close()
  })

  return {
    open(index = 0){
      targetIndex = index
      session = []
      feelings.clear()
      buildMoods()
      restore([])
      modal.open()
    }
  }
}
