// "Find me something…" — describe a mood, get books back, triage in one tap.
//
// The headline feature, and the only part of the app with a backend behind it.
// Everything here degrades to nothing: signed out it never appears, offline it
// says so, and any failure is one plain sentence and a Retry inside the sheet —
// the rest of the app is untouched by all of it.
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

  // The same vocabulary as the finish form. A mood you've used to describe a
  // book you read is exactly the mood worth asking for more of.
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

  // Only ever one of these on screen. Anything else and a stale result list can
  // sit under a spinner, or an error under a result.
  function show(which){
    if(askView) askView.hidden = which !== 'ask'
    if(busy) busy.hidden = which !== 'busy'
    if(results) results.hidden = which !== 'results'
  }

  function fail(type, message){
    if(!errorBox) return
    errorBox.innerHTML = ''
    errorBox.appendChild(el('p', {}, message || messageFor(type)))
    // Over quota isn't a failure to retry — it's an answer. Offering a Retry
    // that can only fail again would be pretending otherwise.
    if(type !== 'over_quota' && type !== 'signed_out'){
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
      if(remainingEl && Number.isFinite(remaining)){
        remainingEl.textContent = remaining === 0
          ? 'That was the last one today.'
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

  // One tap, and the card goes away — the point of triage is that it's fast and
  // you don't have to think about the same book twice.
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
    // Same as the book modal: the book lands first, the series lookup follows
    // it and is never awaited. A suggestion accepted offline is still accepted.
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

  // `why` is the model's reason for offering it, not a fact about the book —
  // it has no business being stored on the shelf.
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
