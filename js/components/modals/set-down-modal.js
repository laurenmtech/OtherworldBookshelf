// "Set it down" — the third thing that can happen to a book you started.
//
// Finishing is not the only honest ending, and neither is deleting. This asks
// the one question that matters — is this a pause or a parting — and treats the
// two answers as genuinely different: a pause changes nothing except where the
// book sits, and a parting goes into the record as something you read part of
// and chose to stop.
//
// Feeling and vibes are optional on both. Setting a book down should cost less
// than finishing one, not more.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { mountMoodPicker } from '../../ui/mood-picker.js'
import { FEELINGS } from '../../state/moods.js'
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
  const feelings = singleSelect(root.querySelector('[data-feeling-chips]'), FEELINGS)
  const moods = mountMoodPicker(root.querySelector('[data-mood-groups]'), {
    input: root.querySelector('[data-new-vibe]'),
    addButton: root.querySelector('[data-add-vibe]')
  })

  // The consequence of each answer, in words, before it happens. "Not for me"
  // writes to the record and excludes the book from suggestions; that is worth
  // knowing in advance rather than discovering afterwards.
  function paintOutcome(value){
    if(outcomeNote) outcomeNote.textContent = value ? OUTCOME_NOTE[value] : ''
    if(submitBtn) submitBtn.disabled = !value
  }

  const modal = createModal(root, {
    onClose(){
      outcomes.clear()
      feelings.clear()
      moods.setValue([])
      paintOutcome(null)
    }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    const outcome = outcomes.getValue()
    if(!outcome) return
    setDownCurrent(targetIndex, {
      outcome,
      feeling: feelings.getValue(),
      moods: moods.getValue()
    })
    modal.close()
  })

  return {
    open(index = 0){
      targetIndex = index
      const book = getState().currentReads[index]
      if(!book) return
      if(bookLine) bookLine.textContent = book.title
      outcomes.clear()
      feelings.clear()
      moods.reset()
      paintOutcome(null)
      modal.open()
    }
  }
}
