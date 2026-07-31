// The Finished route: the full record, and the things it could never afford at
// the bottom of a single scroll — grouped by year, filterable by feeling and
// mood, searchable by title or author.
//
// The filter options are derived from the entries themselves rather than from a
// fixed list. That is what makes them an open set, and it means you can never
// filter to an empty result by picking an option that no book has. Phase 4's
// "set down" joins the feeling facet the first time a book carries it — it
// isn't a feeling anyone picks, so it's read off the flag rather than the
// field, which is the only line here that had to know about it.
import { el } from '../ui/dom.js'
import { subscribe, getState } from '../state/store.js'
import { multiSelect } from '../ui/chips.js'
import { renderFinished } from '../components/finished-list.js'
import { FEELINGS, MOODS, SET_DOWN, feelingLabel } from '../state/moods.js'

// Known values keep their canonical order; anything unrecognised follows,
// alphabetically, so a new state never jumps the queue.
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

  // Rebuild a chip group only when the available options actually change —
  // rebuilding on every keystroke would drop focus mid-interaction.
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

    // A filter with nothing to filter by is noise, not a control.
    if(feelingWrap) feelingWrap.hidden = fOpts.length === 0
    if(moodWrap) moodWrap.hidden = mOpts.length === 0
  }

  function matches(item){
    if(query){
      const hay = `${item.title || ''} ${item.author || ''}`.toLowerCase()
      if(!hay.includes(query)) return false
    }
    // "Set down" sits in this facet but lives on its own flag, so a book that
    // was set down without saying how it felt still answers to that chip.
    if(feelings.length){
      const bySetDown = feelings.includes(SET_DOWN) && item.setDown
      if(!bySetDown && !(item.feeling && feelings.includes(item.feeling))) return false
    }
    // Within a facet, selecting two options widens the result rather than
    // narrowing it to books carrying both.
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

    // Filtering ungroups. A series is one entry while you're browsing, but the
    // moment you ask a question — "which of these did I love?" — you want the
    // books that answer it, not a seven-volume row containing one of them.
    // It also keeps the count below honest without a special case: filtered or
    // not, it counts volumes, because volumes are what you read.
    renderFinished(listRoot, entries, { group: !filtering })

    if(clearBtn) clearBtn.hidden = !filtering

    // A count, and only a count. It says how much is here, not how well you're
    // doing — there is nothing to keep up with.
    if(countEl){
      const noun = `book${finished.length === 1 ? '' : 's'}`
      countEl.textContent = filtering
        ? `${entries.length} of ${finished.length} ${noun}`
        : `${finished.length} ${noun}`
      countEl.hidden = finished.length === 0
    }

    if(emptyEl){
      if(finished.length === 0){
        emptyEl.textContent = 'Nothing here yet — books you finish will collect here.'
        emptyEl.hidden = false
      } else if(entries.length === 0){
        emptyEl.textContent = 'No books match those filters.'
        emptyEl.hidden = false
      } else {
        emptyEl.hidden = true
      }
    }
  }

  render(getState())
  return subscribe(render)
}
