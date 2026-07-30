// The grouped vibe chips, plus the field for typing one of your own.
//
// Extracted from finish-modal.js when Phase 4's "set it down" needed the same
// control: both moments ask the same optional question, and a second copy of
// this would be a second place for the vocabulary to drift.
//
// The words themselves live in state/moods.js — this is only the control that
// offers them.
import { el } from './dom.js'
import { multiSelect } from './chips.js'
import { MOOD_GROUPS, MOODS, customMoods } from '../state/moods.js'
import { getState } from '../state/store.js'

// root gets the groups; the "+ New vibe…" input and its button are optional.
// Returns { reset, getValue, setValue }.
export function mountMoodPicker(root, { input, addButton } = {}){
  let controls = []   // one multiSelect per group
  let session = []    // vibes typed during this open, not yet saved anywhere

  const getValue = () => controls.flatMap(c => c.getValue())
  // setValue keeps only the keys a group actually owns, so handing every group
  // the full selection is the whole restore.
  const setValue = (values) => controls.forEach(c => c.setValue(values || []))

  function build(){
    if(!root) return
    const known = new Set(MOODS)
    const yours = Array.from(new Set([
      ...customMoods(getState().finished),
      ...session
    ])).filter(m => !known.has(m)).sort()

    const defs = yours.length ? [...MOOD_GROUPS, { label: 'Yours', moods: yours }] : MOOD_GROUPS

    root.innerHTML = ''
    controls = defs.map(def => {
      const chips = el('div', { className: 'chips' })
      root.appendChild(el('div', { className: 'mood-group' },
        el('div', { className: 'mood-group-label' }, def.label),
        chips
      ))
      return multiSelect(chips, def.moods)
    })
  }

  function addVibe(){
    if(!input) return
    const name = input.value.trim()
    if(!name) return
    const keep = getValue()
    // Typing a word that already exists just selects it rather than making a
    // near-duplicate sitting in a different group.
    const match = [...MOODS, ...session].find(m => m.toLowerCase() === name.toLowerCase())
    const value = match || name
    if(!match) session.push(value)
    input.value = ''
    build()
    setValue([...keep, value])
    input.focus()
  }

  addButton && addButton.addEventListener('click', addVibe)
  // Enter in this field means "add this vibe", not "submit the form".
  input && input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); addVibe() }
  })

  return {
    // Called on every open: rebuild from current data, forget last time.
    reset(){ session = []; build(); setValue([]) },
    getValue,
    setValue
  }
}
