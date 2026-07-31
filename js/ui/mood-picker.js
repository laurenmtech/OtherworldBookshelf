// The grouped vibe chips plus "new vibe", shared by finishing and setting down.
import { el } from './dom.js'
import { multiSelect } from './chips.js'
import { MOOD_GROUPS, MOODS, customMoods } from '../state/moods.js'
import { getState } from '../state/store.js'

export function mountMoodPicker(root, { input, addButton } = {}){
  let controls = []   // one multiSelect per group
  let session = []    // vibes typed during this open, not yet saved anywhere

  const getValue = () => controls.flatMap(c => c.getValue())
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
    const match = [...MOODS, ...session].find(m => m.toLowerCase() === name.toLowerCase())
    const value = match || name
    if(!match) session.push(value)
    input.value = ''
    build()
    setValue([...keep, value])
    input.focus()
  }

  addButton && addButton.addEventListener('click', addVibe)
  input && input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); addVibe() }
  })

  return {
    reset(){ session = []; build(); setValue([]) },
    getValue,
    setValue
  }
}
