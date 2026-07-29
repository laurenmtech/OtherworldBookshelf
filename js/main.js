// Boot: load state, mount the shell, wire the routes, register the SW.
import {
  init as initStore, addLibrary, editLibrary, addBookstore, editBookstore
} from './state/store.js'
import { mountFinishModal } from './components/modals/finish-modal.js'
import { mountBookModal } from './components/modals/book-modal.js'
import { mountPlaceModal } from './components/modals/place-modal.js'
import { mountHiddenShelf } from './components/hidden-shelf.js'
import { mountTabBar } from './components/tab-bar.js'
import { createRouter } from './routes/router.js'
import { mountReading } from './routes/reading.js'
import { mountFinished } from './routes/finished.js'
import { isAnyModalOpen, hasDirtyInput } from './ui/modal.js'

// Shown in the footer. Tracks the plan's phases, not individual releases: it
// reads 0.N once phase N is complete, so finishing phase 7 — the "ready to
// share" milestone — is what makes this 1.0. Most releases leave it untouched.
// This is NOT the cache buster; sw.js has its own BUILD counter for that.
export const APP_VERSION = '0.2'

function mountAll(){
  const finishModal = mountFinishModal(document.getElementById('finish-form'))
  const bookModal = mountBookModal(document.getElementById('wishlist-modal'))
  const libraryModal = mountPlaceModal(document.getElementById('library-modal'), {
    addTitle: 'Add to Library', editTitle: 'Edit Library',
    onAdd: addLibrary, onEdit: editLibrary
  })
  const bookstoreModal = mountPlaceModal(document.getElementById('bookstore-modal'), {
    addTitle: 'Add a Bookstore', editTitle: 'Edit Bookstore',
    onAdd: addBookstore, onEdit: editBookstore
  })

  const readingEl = document.getElementById('route-reading')
  const finishedEl = document.getElementById('route-finished')

  // Both routes mount once, at boot, and stay mounted. They re-render from the
  // store whether or not they're the visible tab, which costs nothing at this
  // size and means switching tabs never waits on a render.
  mountReading(readingEl, { finishModal, bookModal })
  mountFinished(finishedEl)

  mountHiddenShelf(document.getElementById('hidden-shelf'), {
    libraryModal,
    bookstoreModal,
    openButton: document.getElementById('shelf-btn')
  })

  const tabs = mountTabBar(document.getElementById('tab-bar'))

  createRouter({
    routes: [
      { path: '/', el: readingEl },
      { path: '/finished', el: finishedEl }
    ],
    fallback: '/',
    onChange: (path) => tabs.setActive(path)
  })

  // Close any open dropdown when clicking elsewhere.
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.dropdown.open').forEach(d => {
      if(!d.contains(e.target)) d.classList.remove('open')
    })
  })

  // The running version, as a plain label — there is nothing to tap. Updates
  // arrive on their own (see registerServiceWorker below).
  const versionEl = document.getElementById('app-version')
  if(versionEl) versionEl.textContent = APP_VERSION
}

// Updates apply themselves, but never on top of someone mid-sentence: if a
// modal is open or a field has text in it, hold the reload until it's safe.
function reloadWhenSafe(){
  const attempt = () => {
    if(isAnyModalOpen() || hasDirtyInput()){
      setTimeout(attempt, 1500)
      return
    }
    window.location.reload()
  }
  attempt()
}

function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller
  let refreshing = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(!hadController || refreshing) return // skip the first claim on a fresh install
    refreshing = true
    reloadWhenSafe()
  })

  window.addEventListener('load', () => {
    // updateViaCache:'none' -> always fetch sw.js fresh so new versions are detected.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => reg.update().catch(() => {})
      // Re-check whenever the app comes back to the foreground (e.g. reopened from home screen).
      document.addEventListener('visibilitychange', () => { if(!document.hidden) check() })
      check()
    }).catch((err) => console.warn('SW registration failed', err))
  })
}

initStore()
mountAll()
registerServiceWorker()
