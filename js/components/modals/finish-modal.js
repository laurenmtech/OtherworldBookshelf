// "How was it?" — feeling + optional vibes, captured when a book is finished.
//
// The vocabulary moved to state/moods.js and the grouped chips to
// ui/mood-picker.js in Phase 4, when "set it down" started asking the same
// question — this file is now only the moment, not the words.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { mountMoodPicker } from '../../ui/mood-picker.js'
import { FEELINGS } from '../../state/moods.js'
import { finishCurrent } from '../../state/store.js'

export function mountFinishModal(root){
  const form = root.querySelector('#finish-form-inner')
  const cancelBtn = root.querySelector('#cancel-finish')
  const bookLine = root.querySelector('[data-finish-book]')

  const feelings = singleSelect(root.querySelector('[data-feeling-chips]'), FEELINGS)
  const moods = mountMoodPicker(root.querySelector('[data-mood-groups]'), {
    input: root.querySelector('[data-new-vibe]'),
    addButton: root.querySelector('[data-add-vibe]')
  })

  let targetIndex = 0

  const modal = createModal(root, {
    onClose(){ feelings.clear(); moods.setValue([]) }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    finishCurrent(targetIndex, { feeling: feelings.getValue(), moods: moods.getValue() })
    modal.close()
  })

  return {
    open(index = 0, book = null){
      targetIndex = index
      // Three books can be current at once, so "Finish" has to say which one.
      if(bookLine) bookLine.textContent = (book && book.title) || ''
      feelings.clear()
      moods.reset()
      modal.open()
    }
  }
}
