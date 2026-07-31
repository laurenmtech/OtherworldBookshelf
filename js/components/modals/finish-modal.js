// "How was it?" — and, for a volume of a series, the announcement of what comes
// next. Announced, never silently substituted: this is the correction point, which
// is what makes an occasionally-wrong series answer survivable.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { mountMoodPicker } from '../../ui/mood-picker.js'
import { FEELINGS } from '../../state/moods.js'
import { finishCurrent, detachSeries, getState } from '../../state/store.js'
import { nextVolume } from '../../services/series.js'

export function mountFinishModal(root){
  const form = root.querySelector('#finish-form-inner')
  const cancelBtn = root.querySelector('#cancel-finish')
  const bookLine = root.querySelector('[data-finish-book]')
  const nextBox = root.querySelector('[data-series-next]')
  const nextLine = root.querySelector('[data-series-next-line]')
  const stopBtn = root.querySelector('[data-series-stop]')

  const feelings = singleSelect(root.querySelector('[data-feeling-chips]'), FEELINGS)
  const moods = mountMoodPicker(root.querySelector('[data-mood-groups]'), {
    input: root.querySelector('[data-new-vibe]'),
    addButton: root.querySelector('[data-add-vibe]')
  })

  let targetIndex = 0
  let targetBook = null
  let next = null
  let stopped = false

  const modal = createModal(root, {
    onClose(){ feelings.clear(); moods.setValue([]) }
  })

  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  function paintNext(){
    if(!nextBox) return
    if(!next){
      nextBox.hidden = true
      return
    }
    nextBox.hidden = false
    if(stopped){
      if(nextLine) nextLine.textContent = `Nothing next — ${targetBook.seriesName} stops here.`
      if(stopBtn) stopBtn.textContent = 'Undo'
    } else if(next.forthcoming){
      const when = Number.isFinite(next.book.year) ? ` (${next.book.year})` : ''
      if(nextLine) nextLine.textContent = `Next up: ${next.book.title}${when} — not out yet, so it goes on your TBR pile.`
      if(stopBtn) stopBtn.textContent = 'Stop here'
    } else {
      if(nextLine) nextLine.textContent = `Next up: ${next.book.title}`
      if(stopBtn) stopBtn.textContent = 'Stop here'
    }
  }

  stopBtn && stopBtn.addEventListener('click', () => {
    stopped = !stopped
    paintNext()
  })

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    finishCurrent(targetIndex, {
      feeling: feelings.getValue(),
      moods: moods.getValue(),
      next: stopped ? null : next
    })
    if(stopped && targetBook && targetBook.seriesKey) detachSeries(targetBook.seriesKey)
    modal.close()
  })

  return {
    open(index = 0, book = null){
      targetIndex = index
      targetBook = book
      stopped = false
      next = book ? nextVolume(book, getState()) : null
      paintNext()
      if(bookLine) bookLine.textContent = (book && book.title) || ''
      feelings.clear()
      moods.reset()
      modal.open()
    }
  }
}
