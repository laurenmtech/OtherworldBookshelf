// Boot: load state, mount components, register the service worker.
import { init as initStore } from './state/store.js'
import { mountHeader } from './components/header.js'
import { mountCurrentReads } from './components/current-reads.js'
import { mountTbrPile } from './components/tbr-pile.js'
import { mountFinishedList } from './components/finished-list.js'
import { mountLibraries } from './components/libraries.js'
import { mountFinishModal } from './components/modals/finish-modal.js'
import { mountBookModal } from './components/modals/book-modal.js'
import { mountLibraryModal } from './components/modals/library-modal.js'
import { isAnyModalOpen, hasDirtyInput } from './ui/modal.js'

// Shown in the footer. Tracks the plan's phases, not individual releases: it
// reads 0.N once phase N is complete, so finishing phase 7 — the "ready to
// share" milestone — is what makes this 1.0. Most releases leave it untouched.
// This is NOT the cache buster; sw.js has its own BUILD counter for that.
export const APP_VERSION = '0.1'

function mountAll(){
  const finishModal = mountFinishModal(document.getElementById('finish-form'))
  const bookModal = mountBookModal(document.getElementById('wishlist-modal'))
  const libraryModal = mountLibraryModal(document.getElementById('library-modal'))

  mountHeader(document.getElementById('auth-area'))
  mountCurrentReads(document.querySelector('.current-panel'), { finishModal })
  mountTbrPile(document.querySelector('.wishlist-panel'), { bookModal })
  mountFinishedList(document.querySelector('.finished-panel'))
  mountLibraries(document.querySelector('.library-panel'), { libraryModal })

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
