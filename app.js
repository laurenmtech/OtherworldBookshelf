// Simple localStorage-backed reading tracker
const LS_KEY = 'otherworld_reads_v1'
// Bump this with every release; it's shown in the footer and matches the SW cache name.
const APP_VERSION = 'v8'
// When signed in, saves also go to the cloud (set by sync.js).
let cloudMode = false

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY)
  if(!raw) return { current: null, wishlist: [], finished: [], library: [] }
    return JSON.parse(raw)
  }catch(e){ console.error('loadState', e); return { current:null, wishlist:[], finished:[], library:[] } }
}


function saveState(state){
  localStorage.setItem(LS_KEY, JSON.stringify(state))
  if(cloudMode && typeof window.__cloudSave === 'function'){
    window.__cloudSave(state)
  }
}

function sortWishlist(){
  state.wishlist.sort((a,b)=>{
    const aa = (a.title||'').toLowerCase()
    const bb = (b.title||'').toLowerCase()
    if(aa < bb) return -1
    if(aa > bb) return 1
    return 0
  })
}

// DOM refs
const currentForm = document.getElementById('current-form')
const titleInput = document.getElementById('current-title')
const authorInput = document.getElementById('current-author')
const coverInput = document.getElementById('current-cover')
const saveCurrentBtn = document.getElementById('save-current')
const finishBtn = document.getElementById('finish-current')
const currentDisplay = document.getElementById('current-display')
const currentImage = document.getElementById('current-image')
const displayTitle = document.getElementById('display-title')
const displayAuthor = document.getElementById('display-author')
const editCurrentBtn = document.getElementById('edit-current')
const finishDisplayBtn = document.getElementById('finish-current-display')
const finishModal = document.getElementById('finish-form')
const finishFormInner = document.getElementById('finish-form-inner')
const ratingInput = document.getElementById('rating')
const notesInput = document.getElementById('notes')
const cancelFinishBtn = document.getElementById('cancel-finish')

const wishlistForm = document.getElementById('wishlist-form')
const wishTitle = document.getElementById('wish-title')
const wishAuthor = document.getElementById('wish-author')
const wishlistEl = document.getElementById('wishlist')
const wishlistEmpty = document.getElementById('wishlist-empty')
const wishlistModal = document.getElementById('wishlist-modal')
const wishlistModalTitle = document.getElementById('wishlist-modal-title')
const addWishBtn = document.getElementById('add-wish-btn')
const cancelWishBtn = document.getElementById('cancel-wish')
let wishEditIndex = null // null = adding, number = editing that entry
const finishedList = document.getElementById('finished-list')

// Library refs
const libraryForm = document.getElementById('library-form')
const libName = document.getElementById('lib-name')
const libUrl = document.getElementById('lib-url')
const libraryEl = document.getElementById('library')
const libraryEmpty = document.getElementById('library-empty')
const libraryModal = document.getElementById('library-modal')
const libraryModalTitle = document.getElementById('library-modal-title')
const addLibraryBtn = document.getElementById('add-library-btn')
const cancelLibraryBtn = document.getElementById('cancel-library')
let libEditIndex = null // null = adding, number = editing that entry

// close dropdowns when clicking elsewhere
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.dropdown.open').forEach(d=>{
    if(!d.contains(e.target)) d.classList.remove('open')
  })
})

let state = loadState()
// ensure library array exists for older data
state.library = state.library || []
// normalize wishlist order on load
sortWishlist()
renderAll()

// ---------- Current flow ----------
currentForm.addEventListener('submit', e=>{
  e.preventDefault()
  const book = { title: titleInput.value.trim(), author: authorInput.value.trim(), cover: coverInput.value.trim() }
  if(!book.title) return alert('Please enter a title')
  state.current = book
  saveState(state)
  renderAll()
})

editCurrentBtn.addEventListener('click', ()=>{
  // populate form for editing
  if(!state.current) return
  titleInput.value = state.current.title || ''
  authorInput.value = state.current.author || ''
  coverInput.value = state.current.cover || ''
  currentForm.classList.remove('hidden')
  currentDisplay.classList.add('hidden')
})

// The display-level finish button opens the finish modal
finishDisplayBtn && finishDisplayBtn.addEventListener('click', ()=>{
  if(!state.current) return alert('No current book to finish')
  finishModal.hidden = false
})

finishBtn.addEventListener('click', ()=>{
  if(!state.current) return alert('No current book to finish')
  // show modal using the boolean `hidden` attribute to avoid CSS flicker on load
  finishModal.hidden = false
})

cancelFinishBtn.addEventListener('click', ()=>{
  finishModal.hidden = true
})

finishFormInner.addEventListener('submit', e=>{
  e.preventDefault()
  const rating = Number(ratingInput.value) || 0
  const notes = notesInput.value.trim() || ''
  const finishedItem = { ...state.current, finishedAt: new Date().toISOString(), rating, notes }
  state.finished.unshift(finishedItem)
  state.current = null
  saveState(state)
  ratingInput.value = 5
  notesInput.value = ''
  finishModal.hidden = true
  renderAll()
})

// ---------- Wishlist ----------
function openWishlistModal(index){
  wishEditIndex = (typeof index === 'number') ? index : null
  if(wishEditIndex !== null){
    const it = state.wishlist[wishEditIndex] || {}
    wishlistModalTitle.textContent = 'Edit Book'
    wishTitle.value = it.title || ''
    wishAuthor.value = it.author || ''
  } else {
    wishlistModalTitle.textContent = 'Add to TBR Pile'
    wishTitle.value = ''
    wishAuthor.value = ''
  }
  wishlistModal.hidden = false
  wishTitle.focus()
}

function closeWishlistModal(){
  wishlistModal.hidden = true
  wishEditIndex = null
}

addWishBtn && addWishBtn.addEventListener('click', ()=> openWishlistModal())
cancelWishBtn && cancelWishBtn.addEventListener('click', closeWishlistModal)
// click the dimmed backdrop (outside the form) to dismiss
wishlistModal && wishlistModal.addEventListener('click', e=>{ if(e.target === wishlistModal) closeWishlistModal() })

wishlistForm.addEventListener('submit', e=>{
  e.preventDefault()
  const title = wishTitle.value.trim()
  if(!title) return
  const it = { title, author: wishAuthor.value.trim() }
  if(wishEditIndex !== null){
    state.wishlist[wishEditIndex] = it
  } else {
    state.wishlist.push(it)
  }
  sortWishlist()
  saveState(state)
  closeWishlistModal()
  renderAll()
})

function setAsCurrentFromWishlist(index){
  const it = state.wishlist.splice(index,1)[0]
  state.current = it
  saveState(state)
  renderAll()
}

function removeWishlist(index){ state.wishlist.splice(index,1); saveState(state); renderAll() }

function removeFinished(index){ state.finished.splice(index,1); saveState(state); renderAll() }

// ---------- Rendering ----------
function renderAll(){
  renderLibrary()
  renderCurrent()
  renderWishlist()
  renderFinished()
}

// ---------- Library ----------
function openLibraryModal(index){
  libEditIndex = (typeof index === 'number') ? index : null
  if(libEditIndex !== null){
    const it = state.library[libEditIndex] || {}
    libraryModalTitle.textContent = 'Edit Library'
    libName.value = it.name || ''
    libUrl.value = it.url || ''
  } else {
    libraryModalTitle.textContent = 'Add to Library'
    libName.value = ''
    libUrl.value = ''
  }
  libraryModal.hidden = false
  libName.focus()
}

function closeLibraryModal(){
  libraryModal.hidden = true
  libEditIndex = null
}

addLibraryBtn && addLibraryBtn.addEventListener('click', ()=> openLibraryModal())
cancelLibraryBtn && cancelLibraryBtn.addEventListener('click', closeLibraryModal)
// click the dimmed backdrop (outside the form) to dismiss
libraryModal && libraryModal.addEventListener('click', e=>{ if(e.target === libraryModal) closeLibraryModal() })

libraryForm && libraryForm.addEventListener('submit', e=>{
  e.preventDefault()
  const name = libName.value.trim()
  if(!name) return
  const it = { name, url: libUrl.value.trim() }
  if(libEditIndex !== null){
    state.library[libEditIndex] = it
  } else {
    state.library.push(it)
  }
  saveState(state)
  closeLibraryModal()
  renderAll()
})

function setAsCurrentFromLibrary(index){
  const it = state.library[index]
  if(!it) return
  // map library entry to a current book shape
  state.current = { title: it.name, author: it.url, cover: '' }
  saveState(state)
  renderAll()
}

function removeLibrary(index){ state.library.splice(index,1); saveState(state); renderAll() }

function renderLibrary(){
  if(!libraryEl) return
  libraryEl.innerHTML = ''
  if(libraryEmpty) libraryEmpty.classList.toggle('hidden', state.library.length > 0)
  state.library.forEach((it, idx)=>{
    const li = document.createElement('li')
    const left = document.createElement('div')
  left.innerHTML = `<div class=small-meta><span class=wishlist-title>${escapeHtml(it.name)}</span><div class=muted><a href="${escapeHtml(it.url||'')}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.url||'')}</a></div></div>`
    const actions = document.createElement('div')
    actions.className = 'list-actions'
    const setBtn = document.createElement('button')
    setBtn.className='btn'
    setBtn.innerHTML = `<svg><use href="#icon-finish"></use></svg>Set current`
    setBtn.addEventListener('click', ()=> setAsCurrentFromLibrary(idx))
    const editBtn = document.createElement('button')
    editBtn.className='btn'
    editBtn.innerHTML = `<svg><use href="#icon-edit"></use></svg>Edit`
    editBtn.addEventListener('click', ()=> openLibraryModal(idx))
    const delBtn = document.createElement('button')
    delBtn.className='btn'
    delBtn.innerHTML = `<svg><use href="#icon-trash"></use></svg>Remove`
    delBtn.addEventListener('click', ()=> removeLibrary(idx))
    actions.appendChild(setBtn); actions.appendChild(editBtn); actions.appendChild(delBtn)
    li.appendChild(left); li.appendChild(actions)
    libraryEl.appendChild(li)
  })
}

function renderCurrent(){
  if(state.current){
    currentForm.classList.add('hidden')
    currentDisplay.classList.remove('hidden')
    displayTitle.textContent = state.current.title
    displayAuthor.textContent = state.current.author || ''
    if(state.current.cover){ currentImage.src = state.current.cover; currentImage.style.display = '' } else { currentImage.style.display = 'none' }
  } else {
    currentForm.classList.remove('hidden')
    currentDisplay.classList.add('hidden')
    titleInput.value = ''
    authorInput.value = ''
    coverInput.value = ''
  }
}

function renderWishlist(){
  wishlistEl.innerHTML = ''
  if(wishlistEmpty) wishlistEmpty.classList.toggle('hidden', state.wishlist.length > 0)
  state.wishlist.forEach((it, idx)=>{
    const li = document.createElement('li')
  const left = document.createElement('div')
  left.innerHTML = `<div class=small-meta><span class="wishlist-title">${escapeHtml(it.title)}</span><div class=muted>${escapeHtml(it.author||'')}</div></div>`
  const actions = document.createElement('div')
  actions.className = 'list-actions'
  const setBtn = document.createElement('button')
  setBtn.className='btn'
  setBtn.innerHTML = `<svg><use href="#icon-finish"></use></svg>Set current`
  setBtn.addEventListener('click', ()=> setAsCurrentFromWishlist(idx))
  const editBtn = document.createElement('button')
  editBtn.className='btn'
  editBtn.innerHTML = `<svg><use href="#icon-edit"></use></svg>Edit`
  editBtn.addEventListener('click', ()=> openWishlistModal(idx))
  const delBtn = document.createElement('button')
  delBtn.className='btn'
  delBtn.innerHTML = `<svg><use href="#icon-trash"></use></svg>Remove`
  delBtn.addEventListener('click', ()=> removeWishlist(idx))
  actions.appendChild(setBtn); actions.appendChild(editBtn); actions.appendChild(delBtn)
  li.appendChild(left)
  li.appendChild(actions)
    wishlistEl.appendChild(li)
  })
}

function renderFinished(){
  finishedList.innerHTML = ''
  state.finished.forEach((it, idx)=>{
    const li = document.createElement('li')
    const left = document.createElement('div')
    left.innerHTML = `<div><strong>${escapeHtml(it.title)}</strong> <span class=muted>by ${escapeHtml(it.author||'')}</span><div class=muted>Rated ${it.rating} · ${new Date(it.finishedAt).toLocaleDateString()}</div></div>`
  const actions = document.createElement('div')
  actions.className = 'list-actions'

  // dropdown container
  const dropdown = document.createElement('div')
  dropdown.className = 'dropdown'

  const toggle = document.createElement('button')
  toggle.className = 'btn dropdown-toggle'
  toggle.innerHTML = 'Actions'
  toggle.addEventListener('click', ()=> dropdown.classList.toggle('open'))

  const menu = document.createElement('div')
  menu.className = 'dropdown-menu'

  const notesBtn = document.createElement('button')
  notesBtn.className='btn'
  notesBtn.textContent='Notes'
  notesBtn.addEventListener('click', ()=> alert(it.notes || 'No notes'))

  const delBtn = document.createElement('button')
  delBtn.className='btn'
  delBtn.innerHTML = `<svg><use href="#icon-trash"></use></svg>Remove`
  delBtn.addEventListener('click', ()=> removeFinished(idx))

  menu.appendChild(notesBtn)
  menu.appendChild(delBtn)
  dropdown.appendChild(toggle)
  dropdown.appendChild(menu)
  actions.appendChild(dropdown)
  li.appendChild(left); li.appendChild(actions)
    finishedList.appendChild(li)
  })
}

// Finished Books: expanded on desktop, collapsed by default on phones.
const finishedDetails = document.querySelector('.finished-details')
const finishedMQ = window.matchMedia('(max-width:760px)')
function syncFinishedOpen(){ if(finishedDetails) finishedDetails.open = !finishedMQ.matches }
syncFinishedOpen()
finishedMQ.addEventListener('change', syncFinishedOpen)

// Show the running version in the footer so you can confirm what's loaded.
const versionEl = document.getElementById('app-version')
if(versionEl) versionEl.textContent = APP_VERSION

// ---------- Cloud sync bridge (used by sync.js) ----------
function normalizeState(data){
  data = data || {}
  return {
    current: data.current || null,
    wishlist: Array.isArray(data.wishlist) ? data.wishlist : [],
    finished: Array.isArray(data.finished) ? data.finished : [],
    library: Array.isArray(data.library) ? data.library : []
  }
}
// Replace the in-memory state from a remote snapshot and re-render (no write-back).
window.__applyRemoteState = function(data){
  state = normalizeState(data)
  sortWishlist()
  renderAll()
}
// Current local data (for first-login migration to the cloud).
window.__getLocalState = function(){ return normalizeState(loadState()) }
// Toggle whether saves also write to the cloud.
window.__setCloudMode = function(on){ cloudMode = !!on }
// Revert to local-only data (used on sign-out).
window.__loadLocal = function(){
  state = normalizeState(loadState())
  sortWishlist()
  renderAll()
}

// tiny helper
function escapeHtml(s){ if(!s) return '' ; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
