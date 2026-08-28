// "Find me something…" Everything here degrades to nothing: hidden when signed out,
// and any failure is one plain sentence and a Retry inside the sheet.
import { createModal } from '../../ui/modal.js'
import { multiSelect } from '../../ui/chips.js'
import { el, escapeHtml } from '../../ui/dom.js'
import { coverImg } from '../../ui/cover.js'
import { subtitle } from '../../ui/book-meta.js'
import { MOODS } from '../../state/moods.js'
import { askForBooks, messageFor } from '../../services/recommend.js'
import { enrich } from '../../services/series.js'
import { getState, addToTbr, addAlreadyRead, passSuggestion } from '../../state/store.js'

export function mountRecommendModal(root){
  if(!root) return { open(){} }
  const form = root.querySelector('#recommend-form')
  const moodBox = root.querySelector('#recommend-moods')
  const freeInput = root.querySelector('#recommend-text')
  const askBtn = root.querySelector('#recommend-ask')
  const cancelBtn = root.querySelector('#recommend-cancel')
  const askView = root.querySelector('#recommend-ask-view')
  const busy = root.querySelector('#recommend-busy')
  const errorBox = root.querySelector('#recommend-error')
  const results = root.querySelector('#recommend-results')
  const remainingEl = root.querySelector('#recommend-remaining')

  const moods = multiSelect(moodBox, MOODS)

  let asking = false
  let lastAsk = null   // what to repeat when Retry is pressed

  const modal = createModal(root, { onClose(){ reset() } })
  cancelBtn && cancelBtn.addEventListener('click', () => modal.close())

  function reset(){
    asking = false
    lastAsk = null
    moods.clear()
    if(freeInput) freeInput.value = ''
    show('ask')
    if(errorBox) errorBox.hidden = true
    if(results) results.innerHTML = ''
  }

  function show(which){
    if(askView) askView.hidden = which !== 'ask'
    if(busy) busy.hidden = which !== 'busy'
    if(results) results.hidden = which !== 'results'
  }

  function fail(type, message){
    if(!errorBox) return
    errorBox.innerHTML = ''
    errorBox.appendChild(el('p', {}, message || messageFor(type)))
    // No "Try again" for the three that trying again cannot fix: the day's
    // allowance, the month's budget, and not being signed in.
    if(type !== 'over_quota' && type !== 'budget_exhausted' && type !== 'signed_out'){
      errorBox.appendChild(el('button', {
        type: 'button', className: 'btn', onClick: () => ask(lastAsk)
      }, 'Try again'))
    }
    errorBox.hidden = false
    show('ask')
  }

  async function ask(request){
    if(asking) return
    asking = true
    lastAsk = request
    if(errorBox) errorBox.hidden = true
    show('busy')
    try{
      const { suggestions, remaining } = await askForBooks(request, getState())
      render(suggestions)
      // null on a reader's own key: no allowance is being counted, so the line
      // is cleared rather than left showing a number from an earlier ask that
      // no longer describes anything.
      if(remainingEl){
        remainingEl.textContent = !Number.isFinite(remaining) ? ''
          : remaining === 0 ? 'That was the last one today.'
          : `${remaining} more today.`
      }
      show('results')
    }catch(err){
      fail(err && err.type, err && err.message)
    }finally{
      asking = false
    }
  }

  form && form.addEventListener('submit', (e) => {
    e.preventDefault()
    ask({ moods: moods.getValue(), freeText: (freeInput && freeInput.value.trim()) || '' })
  })

  function card(book){
    const li = el('li', { className: 'suggestion' })
    const art = coverImg(book, { size: 'S', className: 'row-cover' })
    const main = el('div', { className: 'row-main' })
    if(art) main.appendChild(art)
    const bits = subtitle(book).map(escapeHtml).join(' · ')
    main.appendChild(el('div', {
      className: 'small-meta',
      html: `<span class="wishlist-title">${escapeHtml(book.title)}</span>` +
            (bits ? `<div class=muted>${bits}</div>` : '') +
            (book.why ? `<p class="suggestion-why">${escapeHtml(book.why)}</p>` : '')
    }))

    const done = () => {
      li.remove()
      if(results && !results.querySelector('.suggestion')){
        results.appendChild(el('p', { className: 'muted' }, 'That’s all of them.'))
      }
    }
    const take = (add) => () => {
      const clean = strip(book)
      add(clean)
      enrich(clean)
      done()
    }
    const actions = el('div', { className: 'list-actions' },
      el('button', { type: 'button', className: 'btn primary',
        onClick: take(addToTbr) }, '+ TBR'),
      el('button', { type: 'button', className: 'btn',
        onClick: take(addAlreadyRead) }, 'Already read'),
      el('button', { type: 'button', className: 'btn',
        onClick: () => { passSuggestion(book); done() } }, 'Pass')
    )
    li.appendChild(main)
    li.appendChild(actions)
    return li
  }

  function strip(book){
    const { why, ...rest } = book
    return rest
  }

  function render(suggestions){
    if(!results) return
    results.innerHTML = ''
    const list = el('ul', { className: 'list suggestions' })
    suggestions.forEach(b => list.appendChild(card(b)))
    results.appendChild(list)
  }

  return {
    open(){
      reset()
      modal.open(freeInput)
    }
  }
}
