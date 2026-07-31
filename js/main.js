// Boot: load state, mount the shell, wire the routes, register the SW.
import {
  init as initStore, getState, addLibrary, editLibrary, addBookstore, editBookstore
} from './state/store.js'
import { mountFinishModal } from './components/modals/finish-modal.js'
import { mountBookModal } from './components/modals/book-modal.js'
import { mountSetDownModal } from './components/modals/set-down-modal.js'
import { mountRecommendModal } from './components/modals/recommend-modal.js'
import { mountPlaceModal } from './components/modals/place-modal.js'
import { mountHiddenShelf } from './components/hidden-shelf.js'
import { mountVibePicker } from './components/vibe-picker.js'
import { mountVibe } from './vibes/apply.js'
import { isEmptyState } from './state/migrate.js'
import { mountTabBar } from './components/tab-bar.js'
import { createRouter } from './routes/router.js'
import { mountReading } from './routes/reading.js'
import { mountFinished } from './routes/finished.js'
import { isAnyModalOpen, hasDirtyInput } from './ui/modal.js'
import { onAuthChange } from './state/auth.js'

// Shown in the footer, and bumped on EVERY release so you can tell at a glance
// whether your phone has the newest one.
//
// The digit after the point is the plan phase; the digit after that counts
// releases within it. So phase 2 shipped as 0.2, its next release is 0.21, and
// finishing phase 3 resets to 0.3. Phase 7 — the "ready to share" milestone —
// is what makes this 1.0.
export const APP_VERSION = '0.66'

function mountAll(){
  const finishModal = mountFinishModal(document.getElementById('finish-form'))
  const bookModal = mountBookModal(document.getElementById('book-modal'))
  const setDownModal = mountSetDownModal(document.getElementById('set-down-modal'))

  // The recommender is the one feature that needs a verified identity, so it is
  // hidden outright when signed out rather than shown and then rejected. The
  // button lives in the TBR panel head; auth.js tells us when to reveal it.
  const recommendModal = mountRecommendModal(document.getElementById('recommend-modal'))
  const findBtn = document.getElementById('find-something-btn')
  findBtn && findBtn.addEventListener('click', () => recommendModal.open())
  onAuthChange((user) => {
    if(findBtn) findBtn.classList.toggle('hidden', !user)
  })
  const libraryModal = mountPlaceModal(document.getElementById('library-modal'), {
    addTitle: 'Add to Library', editTitle: 'Edit Library',
    onAdd: addLibrary, onEdit: editLibrary,
    library: true   // asks which library on Libby, and confirms it
  })
  const bookstoreModal = mountPlaceModal(document.getElementById('bookstore-modal'), {
    addTitle: 'Add a Bookstore', editTitle: 'Edit Bookstore',
    onAdd: addBookstore, onEdit: editBookstore,
    shop: true   // can learn the shop's search URL
  })

  const readingEl = document.getElementById('route-reading')
  const finishedEl = document.getElementById('route-finished')

  // Both routes mount once, at boot, and stay mounted. They re-render from the
  // store whether or not they're the visible tab, which costs nothing at this
  // size and means switching tabs never waits on a render.
  mountReading(readingEl, { finishModal, bookModal, setDownModal })
  mountFinished(finishedEl, { bookModal })

  // Keeps the document wearing whatever the store says, which is how a vibe
  // follows you to a second device after signing in.
  mountVibe()
  const vibePicker = mountVibePicker(document.getElementById('vibe-picker'))

  mountHiddenShelf(document.getElementById('hidden-shelf'), {
    libraryModal,
    bookstoreModal,
    vibePicker,
    openButton: document.getElementById('shelf-btn'),
    // Picking a vibe from the shelf ends the errand: the sheet closes and you
    // land on the reader, which is the only place the new look means anything.
    // Reads `router` from below — this only ever runs on a tap, long after.
    onVibePicked: () => router.navigate('/')
  })

  // A brand-new reader chooses before seeing the shelf. Someone who already has
  // books has an established look and is never interrupted to confirm it — they
  // stay on Otherworld until they go looking for the picker themselves.
  const state = getState()
  if(!state.vibe && isEmptyState(state)) vibePicker.open({ firstRun: true })

  const tabs = mountTabBar(document.getElementById('tab-bar'))

  const router = createRouter({
    routes: [
      { path: '/', el: readingEl },
      { path: '/finished', el: finishedEl }
    ],
    fallback: '/',
    onChange: (path) => tabs.setActive(path)
  })


  // The running version, as a plain label — there is nothing to tap. Updates
  // arrive on their own (see registerServiceWorker below).
  showVersion()
}

// The footer also shows the build, read from the cache the service worker
// actually installed rather than from a constant over here — which could only
// ever tell you what this file believes, not what your phone is running. It's
// the one number that can't be stale or forgotten: the pre-push hook enforces
// it, and it comes from the cache itself.
async function showVersion(){
  const el = document.getElementById('app-version')
  if(!el) return
  el.textContent = APP_VERSION
  try{
    const builds = (await caches.keys())
      .map(k => /^otherworld-reads-build-(\d+)$/.exec(k))
      .filter(Boolean)
      .map(m => Number(m[1]))
    if(builds.length) el.textContent = `${APP_VERSION} · build ${Math.max(...builds)}`
  }catch(e){ /* no cache API, or blocked — the version alone is fine */ }
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
