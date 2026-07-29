# Architecture

Where things live and how state flows. No build step, no dependencies — native
ES modules and plain CSS, served straight from GitHub Pages.

## Running it locally

```sh
python3 -m http.server 8000   # from the repo root → http://localhost:8000
```

The app can't be opened as a `file://` path: ES modules, the service worker and
Firebase auth all need an origin. `localhost` counts as a secure context, so the
service worker registers and auth works there exactly as in production.

**If your changes don't appear, it's almost always the service worker serving
its cache.** In DevTools → Application → Service Workers, tick *Update on
reload* and *Bypass for network* while developing.

## Layout

```
index.html            markup + <script type="module" src="js/main.js">
sw.js                 service worker (precache list must list every file below)
firebase-config.js    plain script; sets window.FIREBASE_CONFIG
manifest.webmanifest

styles/
  tokens.css          every colour and font, as custom properties
  base.css            reset, page chrome, layout grid
  components.css      panels, cards, lists, buttons, chips, modals

js/
  main.js             boot: init store, mount components, register SW

  state/
    store.js          the single source of truth + subscribe()
    migrate.js        forward migrations, safe to re-run
    persist-local.js  localStorage adapter
    persist-cloud.js  Firestore adapter (live snapshot, saves, seeding)
    auth.js           Google sign-in, Firestore handle

  components/
    header.js         account controls + sync status
    current-reads.js  the Current Read card
    tbr-pile.js       what's next
    finished-list.js  the record
    libraries.js      libraries and bookshops
    modals/
      finish-modal.js   how was it? feeling + moods
      book-modal.js     add/edit a TBR book
      library-modal.js  add/edit a library

  ui/
    dom.js            el(), escapeHtml(), iconButton(), focus trap
    modal.js          shared open/close/backdrop/Escape/focus behaviour
    chips.js          the selectable-chip control
```

## How state flows

One module owns the shelf. Components never mutate state, never read
`localStorage`, and never touch Firestore — they call an action and re-render
when notified.

```
              ┌──────────────────────────────┐
  action ───▶ │  store.js                    │
              │    state (deep-frozen)       │
              └───────┬──────────────┬───────┘
                      │              │
              notify subscribers   persist
                      │              │
                      ▼              ├──▶ persist-local.js   (always)
                 components          └──▶ persist-cloud.js   (when signed in)
```

```js
getState()          // current shelf, frozen — read-only by construction
subscribe(fn)       // called on every change; returns an unsubscribe
addCurrent(book)    // …and the other actions, the only way to change anything
```

Actions: `addCurrent`, `editCurrent`, `finishCurrent`, `addToTbr`, `editTbr`,
`removeTbr`, `makeTbrCurrent`, `removeFinished`, `addLibrary`, `editLibrary`,
`removeLibrary`, `makeLibraryCurrent`, plus the lifecycle calls `init`,
`reloadLocal`, `applyRemote` and `setCloudSave`.

`applyRemote` and `reloadLocal` commit **without** persisting — state that came
*from* storage must not be written straight back.

## Data shape

```js
{
  currentReads: [ { title, author } ],   // capped at 1 until Phase 3
  wishlist:     [ { title, author } ],   // kept sorted by title
  finished:     [ { title, author, finishedAt, feeling, moods[] } ],
  library:      [ { name, url } ]
}
```

`migrate.js` normalises anything loaded or received: unknown keys are dropped,
missing keys get empty defaults, and it is safe to run twice. It currently
performs one migration, `current` → `currentReads[]`.

**Transitional:** `toStorage()` also writes a legacy `current` field mirroring
`currentReads[0]`, so a device still running v14 can read and round-trip the
document without wiping the newer field. Remove that mirror in Phase 4.

## Adding a component

1. Export a `mount(root, deps)` that takes its mount point.
2. Read with `getState()`, change with actions, re-render in `subscribe()`.
3. Mount it in `main.js`.
4. **Add the file to `ASSETS` in `sw.js`** — a missing entry fails the whole
   precache and the service worker never activates.
5. Bump `BUILD` in `sw.js`. Do this on every deploy — it is what invalidates the
   old cache. `APP_VERSION` in `js/main.js` is separate: it tracks plan phases
   (`0.N` after phase N, `1.0` at phase 7), so most deploys leave it alone.

## Updates

Updates apply themselves: the service worker calls `skipWaiting()` on install
and `clients.claim()` on activate, and the page reloads once on
`controllerchange`. `main.js` re-checks on every return to the foreground, and
holds the reload while a modal is open or a field has text in it, so an update
never lands on top of someone mid-sentence. There is nothing to tap.
