// The Finished route. Filter options are derived from the entries themselves, so
// you can never filter to an empty result by picking something no book has.
//
// Filtering passes group:false — a question deserves literal answers, and it keeps
// the count honest with no special case.
import { el } from '../ui/dom.js'
import { subscribe, getState } from '../state/store.js'
import { multiSelect } from '../ui/chips.js'
import { renderFinished } from '../components/finished-list.js'
import { FEELINGS, MOODS, SET_DOWN, feelingLabel } from '../state/moods.js'

function ordered(present, known){
  const inKnown = known.filter(k => present.has(k))
  const extra = Array.from(present).filter(k => !known.includes(k)).sort()
  return [...inKnown, ...extra]
}

export function mountFinished(root, { bookModal } = {}){
  if(!root) return

  const addBtn = root.querySelector('#add-finished-btn')
  addBtn && bookModal && addBtn.addEventListener('click', () => bookModal.open({ dest: 'finished' }))

  const searchInput = root.querySelector('#finished-search')
  const feelingBox = root.querySelector('#feeling-filter')
  const moodBox = root.querySelector('#mood-filter')
  const feelingWrap = root.querySelector('#feeling-filter-field')
  const moodWrap = root.querySelector('#mood-filter-field')
  const clearBtn = root.querySelector('#clear-filters')
  const listRoot = root.querySelector('#finished-list')
  const emptyEl = root.querySelector('#finished-empty')
  const countEl = root.querySelector('#finished-count')

  let query = ''
  let feelings = []
  let moods = []
  let feelingChips = null
  let moodChips = null
  let feelingKeys = ''
  let moodKeys = ''

  searchInput && searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase()
    render(getState())
  })

  clearBtn && clearBtn.addEventListener('click', () => {
    query = ''
    feelings = []
    moods = []
    if(searchInput) searchInput.value = ''
    if(feelingChips) feelingChips.clear()
    if(moodChips) moodChips.clear()
    render(getState())
    if(searchInput) searchInput.focus()
  })

  function syncChips(finished){
    const presentFeelings = new Set()
    const presentMoods = new Set()
    for(const item of finished){
      if(item.feeling) presentFeelings.add(item.feeling)
      if(item.setDown) presentFeelings.add(SET_DOWN)
      for(const m of item.moods || []) presentMoods.add(m)
    }

    const fOpts = ordered(presentFeelings, [...FEELINGS.map(f => f.key), SET_DOWN])
    const mOpts = ordered(presentMoods, MOODS)

    if(fOpts.join('\u0000') !== feelingKeys){
      feelingKeys = fOpts.join('\u0000')
      feelingChips = multiSelect(
        feelingBox,
        fOpts.map(k => ({ key: k, label: feelingLabel(k) || k })),
        { onChange: v => { feelings = v; render(getState()) } }
      )
      feelingChips.setValue(feelings)
      feelings = feelingChips.getValue()
    }
    if(mOpts.join('\u0000') !== moodKeys){
      moodKeys = mOpts.join('\u0000')
      moodChips = multiSelect(moodBox, mOpts, {
        onChange: v => { moods = v; render(getState()) }
      })
      moodChips.setValue(moods)
      moods = moodChips.getValue()
    }

    if(feelingWrap) feelingWrap.hidden = fOpts.length === 0
    if(moodWrap) moodWrap.hidden = mOpts.length === 0
  }

  function matches(item){
    if(query){
      const hay = `${item.title || ''} ${item.author || ''}`.toLowerCase()
      if(!hay.includes(query)) return false
    }
    if(feelings.length){
      const bySetDown = feelings.includes(SET_DOWN) && item.setDown
      if(!bySetDown && !(item.feeling && feelings.includes(item.feeling))) return false
    }
    if(moods.length){
      const has = item.moods || []
      if(!moods.some(m => has.includes(m))) return false
    }
    return true
  }

  function render(state){
    const finished = state.finished
    syncChips(finished)

    const entries = finished
      .map((item, index) => ({ item, index }))
      .filter(e => matches(e.item))

    const filtering = !!query || feelings.length > 0 || moods.length > 0

    renderFinished(listRoot, entries, { group: !filtering })

    if(clearBtn) clearBtn.hidden = !filtering

    if(countEl){
      const noun = `book${finished.length === 1 ? '' : 's'}`
      countEl.textContent = filtering
        ? `${entries.length} of ${finished.length} ${noun}`
        : `${finished.length} ${noun}`
      countEl.hidden = finished.length === 0
    }

    if(emptyEl){
      emptyEl.innerHTML = ''
      if(finished.length === 0){
        emptyEl.appendChild(el('p', {}, 'Everything you finish collects here, with the date and how it felt. ' +
          'Books you set down are kept too — reading part of something is still reading it.'))
        emptyEl.appendChild(el('button', {
          type: 'button', className: 'btn primary',
          onClick: () => bookModal && bookModal.open({ dest: 'finished' })
        }, 'Add a book you’ve read'))
        emptyEl.hidden = false
      } else if(entries.length === 0){
        emptyEl.appendChild(el('p', {}, `No books match those filters, out of ${finished.length} in your record.`))
        emptyEl.appendChild(el('button', {
          type: 'button', className: 'btn', onClick: () => clearBtn && clearBtn.click()
        }, 'Clear filters'))
        emptyEl.hidden = false
      } else {
        emptyEl.hidden = true
      }
    }
  }

  render(getState())
  return subscribe(render)
}
