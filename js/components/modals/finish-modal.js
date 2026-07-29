// "How was it?" — feeling + optional mood vibe, captured when a book is finished.
import { createModal } from '../../ui/modal.js'
import { singleSelect, multiSelect } from '../../ui/chips.js'
import { finishCurrent } from '../../state/store.js'

export const FEELINGS = [
  { key: 'loved', label: '💛 Loved' },
  { key: 'liked', label: 'Liked' },
  { key: 'not-for-me', label: 'Not for me' }
]

export const MOODS = [
  'Cozy', 'Epic', 'Dark', 'Comfort-read', 'Romantic',
  'Twisty', 'Slow-burn', 'Funny', 'Mind-expanding', 'Practical'
]

export const feelingLabel = k => (FEELINGS.find(f => f.key === k) || {}).label

export function mountFinishModal(root){
  const form = root.querySelector('#finish-form-inner')
  const cancelBtn = root.querySelector('#cancel-finish')

  const feelings = singleSelect(root.querySelector('#feeling-chips'), FEELINGS)
  const moods = multiSelect(root.querySelector('#mood-chips'), MOODS)

  let targetIndex = 0

  const modal = createModal(root, {
    onClose(){ feelings.clear(); moods.clear() }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    finishCurrent(targetIndex, { feeling: feelings.getValue(), moods: moods.getValue() })
    modal.close()
  })

  return {
    open(index = 0){
      targetIndex = index
      feelings.clear()
      moods.clear()
      modal.open()
    }
  }
}
