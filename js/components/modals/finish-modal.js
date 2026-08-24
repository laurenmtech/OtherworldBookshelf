// "How was it?" — and, for a volume of a series, the announcement of what comes
// next. Announced, never silently substituted: this is the correction point, which
// is what makes an occasionally-wrong series answer survivable.
import { createModal } from '../../ui/modal.js'
import { singleSelect } from '../../ui/chips.js'
import { mountMoodPicker } from '../../ui/mood-picker.js'
import { FEELINGS } from '../../state/moods.js'
import { finishCurrent, detachSeries, getState, subscribe } from '../../state/store.js'
import { nextVolume, enrich } from '../../services/series.js'
import { needsAsking } from '../../services/series-backfill.js'
import { bookKey, SERIES } from '../../services/book-shape.js'

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
  let unwatch = null

  const modal = createModal(root, {
    onClose(){ feelings.clear(); moods.setValue([]); stopWatching() }
  })

  function stopWatching(){
    if(unwatch) unwatch()
    unwatch = null
  }

  // The announcement used to depend on winning a race it had no way to win.
  //
  // A series is asked for at ADD time, and the answer takes a few seconds —
  // Haiku, then every volume checked against Open Library. Add a book and press
  // Finish before that lands, which is exactly what someone recording a book
  // they read last week does, and the modal opens on a book that doesn't know
  // it is in a series yet: silence, and the one moment the app had to announce
  // book 2 is gone.
  //
  // So the modal asks on the way open if nobody has asked lately, and watches
  // the store while it is up. The answer arrives into a modal the reader is
  // still filling in, and the "Next up" line appears where it would have been.
  // If they finish first, nothing is lost — the record row offers the volume
  // instead (see components/finished-list.js).
  function watchForAnswer(book){
    stopWatching()
    if(!SERIES || !book || next) return
    const key = bookKey(book)
    if(!key) return
    unwatch = subscribe(() => {
      if(next) return
      const state = getState()
      const fresh = (state.currentReads || []).find(b => bookKey(b) === key)
      if(!fresh) return
      const found = nextVolume(fresh, state)
      if(!found) return
      targetBook = fresh
      next = found
      paintNext()
    })
    // The book AS STORED, workKey and all: enrich() patches by bookKey(), and a
    // book found through search is keyed by its work — asking about a bare
    // { title, author } would answer about a key nothing on the shelf holds.
    if(needsAsking(book)) enrich(book)
  }

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
      watchForAnswer(book)
      if(bookLine) bookLine.textContent = (book && book.title) || ''
      feelings.clear()
      moods.reset()
      modal.open()
    }
  }
}
