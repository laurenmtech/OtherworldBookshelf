// The Hidden Shelf — the one shelf that isn't for books. Your card, the places you
// borrow and buy from, and your record: export, import, delete.
import { el } from '../ui/dom.js'
import { createSheet } from '../ui/sheet.js'
import { mountPlaceList } from './places.js'
import { mountHeader } from './header.js'
import { mountInstall } from './install.js'
import { multiSelect } from '../ui/chips.js'
import { askConfirm, showMessage } from '../ui/dialog.js'
import {
  getState, subscribe, resetAll, removeLibrary, removeBookstore,
  reorderLibrary, setBorrowFormats, setFindLinks, importShelf
} from '../state/store.js'
import { BORROW_FORMATS, FIND_LINKS } from '../state/migrate.js'
import { getVibe, DEFAULT_VIBE } from '../vibes/registry.js'
import { toStorage } from '../state/migrate.js'

// The one way to reach a person from inside the app. The address is also
// written into the markup, so the link says where it goes before it is tapped.
const CONTACT_EMAIL = 'laurenmtech@gmail.com'

function stamp(){
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function exportShelf(){
  const json = JSON.stringify(toStorage(getState()), null, 2)
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = el('a', { href: url, download: `otherworld-reads-${stamp()}.json` })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function mountHiddenShelf(root, { libraryModal, bookstoreModal, vibePicker, openButton, onVibePicked }){
  if(!root) return { open(){}, close(){} }

  const sheet = createSheet(root)

  // The subject line carries what the footer knows — version and the build
  // actually installed, read back from the service worker's cache. "It did the
  // wrong thing" is a different bug on build 48 than on build 52, and nobody
  // writing in should have to know that, or be asked.
  //
  // Read off the footer rather than imported: main.js owns APP_VERSION and
  // imports this module, so importing it back would be a cycle — and the
  // footer is the number that is TRUE on this device, which a constant isn't.
  const contact = root.querySelector('[data-contact]')
  function stampContact(){
    if(!contact) return
    const versionEl = document.getElementById('app-version')   // not `el` — that's the DOM helper
    const running = (versionEl && versionEl.textContent) || ''
    const subject = running ? `Otherworld Bookshelf — ${running}` : 'Otherworld Bookshelf'
    contact.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
  }
  stampContact()

  openButton && openButton.addEventListener('click', () => {
    stampContact()   // showVersion() is async, and may have landed since mount
    sheet.open()
  })

  mountHeader(root.querySelector('#auth-area'))

  const changeVibeBtn = root.querySelector('#change-vibe')
  changeVibeBtn && vibePicker && changeVibeBtn.addEventListener('click', () => {
    vibePicker.open({
      onPicked: () => {
        sheet.close()
        onVibePicked && onVibePicked()
      }
    })
  })

  const vibeLabel = root.querySelector('#current-vibe')
  if(vibeLabel){
    const showVibe = (state) => {
      const vibe = getVibe(state.vibe) || getVibe(DEFAULT_VIBE)
      vibeLabel.textContent = `${vibe.name} — ${vibe.blurb}`
    }
    showVibe(getState())
    subscribe(showVibe)
  }

  mountPlaceList(root.querySelector('#library-list'), {
    modal: libraryModal,
    select: s => s.library,
    remove: removeLibrary,
    // No "Set current" here. It called addCurrent() with the library's name as a
    // title and its URL as the author, so tapping it put your library on the
    // shelf as a book you were reading. Which library is the working one is
    // decided by ORDER — first with a key wins, hence the reorder arrows and the
    // Primary badge — and never by an action that means something else.
    reorder: reorderLibrary
  })

  const FORMAT_LABELS = { ebook: 'Ebook', audiobook: 'Audiobook' }
  const formatChips = multiSelect(
    root.querySelector('#borrow-format-chips'),
    BORROW_FORMATS.map(k => ({ key: k, label: FORMAT_LABELS[k] || k })),
    { onChange: (v) => setBorrowFormats(v) }
  )
  formatChips.setValue(getState().borrowFormats || [])
  subscribe((s) => {
    const want = (s.borrowFormats || []).join()
    if(want !== formatChips.getValue().join()) formatChips.setValue(s.borrowFormats || [])
  })

  const FIND_LABELS = { library: 'My library', shop: 'A bookshop' }
  const findChips = multiSelect(
    root.querySelector('#find-link-chips'),
    FIND_LINKS.map(k => ({ key: k, label: FIND_LABELS[k] || k })),
    { onChange: (v) => setFindLinks(v) }
  )
  findChips.setValue(getState().findLinks || [])
  subscribe((s) => {
    const want = (s.findLinks || []).join()
    if(want !== findChips.getValue().join()) findChips.setValue(s.findLinks || [])
  })

  mountPlaceList(root.querySelector('#bookstore-list'), {
    modal: bookstoreModal,
    select: s => s.bookstores,
    remove: removeBookstore
  })

  mountInstall(root.querySelector('#install-section'))

  const exportBtn = root.querySelector('#export-data')
  exportBtn && exportBtn.addEventListener('click', exportShelf)

  const importBtn = root.querySelector('#import-data')
  const importInput = root.querySelector('#import-file')
  importBtn && importInput && importBtn.addEventListener('click', () => importInput.click())

  importInput && importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0]
    importInput.value = ''
    if(!file) return

    let raw
    try{
      raw = JSON.parse(await file.text())
    }catch(err){
      await showMessage({
        title: 'That file couldn’t be read',
        body: `“${file.name}” isn’t valid JSON, so there was nothing to import.\n\n` +
              'It should be a file this app exported — they’re named like ' +
              'otherworld-reads-2026-07-31.json.'
      })
      return
    }

    if(!raw || typeof raw !== 'object' || Array.isArray(raw)){
      await showMessage({
        title: 'That doesn’t look like a shelf',
        body: `“${file.name}” is valid JSON, but it isn’t in the shape this app exports, ` +
              'so nothing was imported.'
      })
      return
    }

    const added = importShelf(raw)
    const lines = [
      [added.currentReads, 'current read', 'current reads'],
      [added.wishlist, 'book on the pile', 'books on the pile'],
      [added.finished, 'book in your record', 'books in your record'],
      [added.library, 'library', 'libraries'],
      [added.bookstores, 'bookshop', 'bookshops']
    ].filter(([n]) => n > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)

    await showMessage({
      title: lines.length ? 'Imported' : 'Nothing new to add',
      body: lines.length
        ? `Added ${lines.join(', ')}.\n\nNothing already on your shelf was changed.`
        : `Everything in “${file.name}” was already here, so nothing changed.`
    })
  })

  const deleteBtn = root.querySelector('#delete-data')
  deleteBtn && deleteBtn.addEventListener('click', async () => {
    const { currentReads, wishlist, finished, library, bookstores } = getState()
    const total = currentReads.length + wishlist.length + finished.length + library.length + bookstores.length
    const ok = await askConfirm({
      title: 'Delete everything?',
      body: `This erases ${total} item${total === 1 ? '' : 's'} — current reads, the TBR pile, ` +
            'your finished books, your libraries and your bookstores.\n\n' +
            'If you’re signed in it deletes them from the cloud too, on every device. ' +
            'This cannot be undone — export first if you might want them back.',
      confirm: 'Delete everything',
      danger: true
    })
    if(ok) resetAll()
  })

  return sheet
}
