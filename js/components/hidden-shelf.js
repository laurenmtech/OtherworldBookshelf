// The Hidden Shelf — the one shelf that isn't for books. Your card, the places
// you borrow and buy from, and your record.
//
// Named for what it is rather than what it does: "settings" is a word for
// software, and this is a reading app. The bottom-sheet presentation it happens
// to use lives in ui/sheet.js, where "sheet" means the interaction pattern.
//
// Vibe lives here as a name and a Change button; the picker itself is its own
// component, because it's also what a brand-new reader meets before they ever
// see this sheet.
import { el } from '../ui/dom.js'
import { createSheet } from '../ui/sheet.js'
import { mountPlaceList } from './places.js'
import { mountHeader } from './header.js'
import { multiSelect } from '../ui/chips.js'
import {
  getState, subscribe, resetAll, removeLibrary, removeBookstore, makeLibraryCurrent,
  reorderLibrary, setBorrowFormats, setFindLinks
} from '../state/store.js'
import { BORROW_FORMATS, FIND_LINKS } from '../state/migrate.js'
import { getVibe, DEFAULT_VIBE } from '../vibes/registry.js'
import { toStorage } from '../state/migrate.js'
import { iconButton } from '../ui/dom.js'

function stamp(){
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// A plain JSON file, in the shape the app actually stores. Readable, and the
// thing you'd hand to an importer.
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
  openButton && openButton.addEventListener('click', () => sheet.open())

  // Account controls moved out of the header and into the sheet; mountHeader
  // still owns them, it just renders somewhere quieter now.
  mountHeader(root.querySelector('#auth-area'))

  // The picker layers above the sheet, so backing out of it without choosing
  // puts you back here rather than at the top of the app. Choosing is the other
  // case: the whole point of a new vibe is seeing your shelf wearing it, so a
  // pick drops both layers and hands you to the reader.
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
    reorder: reorderLibrary,
    // Long-standing behaviour, kept: a library entry can become the current
    // book, with its name as the title.
    extraAction: (_entry, idx) => iconButton('finish', 'Set current', () => makeLibraryCurrent(idx))
  })

  // Which formats the borrow rows are allowed to be about. Built once — the
  // options are fixed — and only the selection is kept in step with the store,
  // so a chip never rebuilds itself out from under the tap that changed it.
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

  // Some readers always borrow, some always buy. Built once, as above.
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

  const exportBtn = root.querySelector('#export-data')
  exportBtn && exportBtn.addEventListener('click', exportShelf)

  const deleteBtn = root.querySelector('#delete-data')
  deleteBtn && deleteBtn.addEventListener('click', () => {
    const { currentReads, wishlist, finished, library, bookstores } = getState()
    const total = currentReads.length + wishlist.length + finished.length + library.length + bookstores.length
    const ok = confirm(
      `Delete everything?\n\n` +
      `This erases ${total} item${total === 1 ? '' : 's'} — current reads, the TBR pile, ` +
      `your finished books, your libraries and your bookstores.\n\n` +
      `If you're signed in it deletes them from the cloud too, on every device. ` +
      `This cannot be undone — export first if you might want them back.`
    )
    if(ok) resetAll()
  })

  return sheet
}
