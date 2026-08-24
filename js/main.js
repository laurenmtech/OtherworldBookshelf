// Boot: load state, mount the shell, wire the routes, register the SW.
//
// APP_VERSION is the human-facing stamp in the footer, bumped every release.
// sw.js BUILD is the cache key and is what the footer actually reads back.
// 1.0 is "ready to share" — phase 8, the point of which was that you could send
// this to someone without explaining it first.
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
import { runFirstRun } from './components/welcome.js'
import { mountVibe } from './vibes/apply.js'
import { isEmptyState } from './state/migrate.js'
import { mountTabBar } from './components/tab-bar.js'
import { createRouter } from './routes/router.js'
import { mountReading } from './routes/reading.js'
import { mountFinished } from './routes/finished.js'
import { isAnyModalOpen, hasDirtyInput } from './ui/modal.js'
import { onAuthChange } from './state/auth.js'
import { watchForNetwork } from './services/backfill.js'
import { watchForSeries } from './services/series-backfill.js'

export const APP_VERSION = '1.0.1'

function mountAll(){
  const finishModal = mountFinishModal(document.getElementById('finish-form'))
  const bookModal = mountBookModal(document.getElementById('book-modal'))
  const setDownModal = mountSetDownModal(document.getElementById('set-down-modal'))

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

  mountReading(readingEl, { finishModal, bookModal, setDownModal })
  mountFinished(finishedEl, { bookModal })

  mountVibe()
  const vibePicker = mountVibePicker(document.getElementById('vibe-picker'))

  mountHiddenShelf(document.getElementById('hidden-shelf'), {
    libraryModal,
    bookstoreModal,
    vibePicker,
    openButton: document.getElementById('shelf-btn'),
    onVibePicked: () => router.navigate('/')
  })

  const state = getState()
  if(!state.vibe && isEmptyState(state)) runFirstRun({ vibePicker, bookModal })

  const tabs = mountTabBar(document.getElementById('tab-bar'))

  const router = createRouter({
    routes: [
      { path: '/', el: readingEl },
      { path: '/finished', el: finishedEl }
    ],
    fallback: '/',
    onChange: (path) => tabs.setActive(path)
  })

  showVersion()
}

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
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const check = () => reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => { if(!document.hidden) check() })
      check()
    }).catch((err) => console.warn('SW registration failed', err))
  })
}

initStore()
mountAll()
registerServiceWorker()
// Books added with no signal finish arriving. After mountAll(), so the lists are
// already subscribed and a book that fills in repaints where it sits.
watchForNetwork()
// And the books that were on the shelf before their series was — same reason for
// the same placement, and it waits for sign-in on its own.
watchForSeries()
