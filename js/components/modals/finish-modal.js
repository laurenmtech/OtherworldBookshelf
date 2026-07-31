// "How was it?" — feeling + optional vibes, captured when a book is finished.
//
// The vocabulary moved to state/moods.js and the grouped chips to
// ui/mood-picker.js in Phase 4, when "set it down" started asking the same
// question — this file is now only the moment, not the words.
//
// Phase 7 added the one thing that happens *after* the moment: if this book is
// a volume of a series, finishing it advances the entry to the next volume, and
// this is where that is ANNOUNCED. Never silently substituted — a reader who
// sees the wrong next book can refuse it in one tap, right here, which is what
// makes an occasionally-wrong series answer survivable rather than annoying.
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
  // What finishing will do, computed when the modal opens rather than when it's
  // submitted — the announcement has to be true of the button you're about to
  // press. Null means nothing happens, which is most books.
  let next = null
  // The reader tapped "Stop here". Held rather than applied immediately so
  // cancelling the whole modal cancels this too.
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
      // Say what will now happen, not what won't — this is the state the reader
      // chose, so it should read as an outcome rather than as a cancellation.
      if(nextLine) nextLine.textContent = `Nothing next — ${targetBook.seriesName} stops here.`
      if(stopBtn) stopBtn.textContent = 'Undo'
    } else if(next.forthcoming){
      // Naming the year rather than just "not out yet" is the difference
      // between a fact and a shrug, and it's already on the record we verified.
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
    // Finish FIRST, then detach. The order matters: detaching marks the books
    // still ahead of you, and the volume being finished is on its way into the
    // record. Detaching first would stamp seriesDetached onto the entry that
    // lands there, quietly splitting it out of the series in the record —
    // which is not what "stop here" asked for.
    finishCurrent(targetIndex, {
      feeling: feelings.getValue(),
      moods: moods.getValue(),
      next: stopped ? null : next
    })
    if(stopped && targetBook && targetBook.seriesKey) detachSeries(targetBook.seriesKey)
    // Nothing is looked up here. The volume that just landed on Current Reads
    // carries the whole series list forward with it, so the NEXT advance is
    // already answered — locally, offline, instantly. That is the difference
    // between asking for a series once and asking for one book at a time.
    modal.close()
  })

  return {
    open(index = 0, book = null){
      targetIndex = index
      targetBook = book
      stopped = false
      // Every rule about whether there IS a next volume lives in nextVolume():
      // detached series, re-reads, volumes already on the pile or in the
      // record, and the end of what we know. Null here is silence — a reader
      // finishing a standalone sees nothing at all.
      next = book ? nextVolume(book, getState()) : null
      paintNext()
      // Three books can be current at once, so "Finish" has to say which one.
      if(bookLine) bookLine.textContent = (book && book.title) || ''
      feelings.clear()
      moods.reset()
      modal.open()
    }
  }
}
