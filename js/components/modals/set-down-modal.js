// "Set it down" — a pause or a parting. It asks that and nothing else: how a book
// felt belongs to finishing one. NEITHER outcome advances a series.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { setDownCurrent, getState } from '../../state/store.js'

const OUTCOMES = [
  { key: 'later', label: 'Not right now' },
  { key: 'never', label: 'Not for me' }
]

const OUTCOME_NOTE = {
  later: 'Back on the TBR pile, exactly as it was. Nothing else changes.',
  never: 'Into your record, marked as set down — and not suggested again.'
}

export function mountSetDownModal(root){
  const form = root.querySelector('form')
  const bookLine = root.querySelector('[data-set-down-book]')
  const outcomeNote = root.querySelector('[data-outcome-note]')
  const cancelBtn = root.querySelector('[data-cancel]')
  const submitBtn = root.querySelector('[data-submit]')

  let targetIndex = 0

  const outcomes = singleSelect(root.querySelector('[data-outcome-chips]'), OUTCOMES, {
    onChange: paintOutcome
  })
  function paintOutcome(value){
    if(outcomeNote) outcomeNote.textContent = value ? OUTCOME_NOTE[value] : ''
    if(submitBtn) submitBtn.disabled = !value
  }

  const modal = createModal(root, {
    onClose(){
      outcomes.clear()
      paintOutcome(null)
    }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const outcome = outcomes.getValue()
    if(!outcome) return
    setDownCurrent(targetIndex, { outcome })
    modal.close()
  })

  return {
    open(index = 0){
      targetIndex = index
      const book = getState().currentReads[index]
      if(!book) return
      if(bookLine) bookLine.textContent = book.title
      outcomes.clear()
      paintOutcome(null)
      modal.open()
    }
  }
}
