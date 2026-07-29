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
  main.js             boot: init store, mount the shell, wire routes, register SW

  routes/
    router.js         hash routing, per-tab scroll, focus on change
    reading.js        #/          current reads + TBR
    finished.js       #/finished  the archive, with search and filters

  state/
    store.js          the single source of truth + subscribe()
    migrate.js        forward migrations, safe to re-run
    persist-local.js  localStorage adapter
    persist-cloud.js  Firestore adapter (live snapshot, saves, seeding)
    auth.js           Google sign-in, Firestore handle

  components/
    tab-bar.js        the two tabs; bottom bar on a phone, header links wide
    hidden-shelf.js   "The Hidden Shelf": card, places, record
    header.js         account controls + sync status (rendered in the sheet)
    current-reads.js  the Current Read card
    tbr-pile.js       what's next
    finished-list.js  the record — renders an already-filtered list
    places.js         saved places: libraries AND bookstores, one list impl
    modals/
      finish-modal.js   how was it? feeling + vibes
      book-modal.js     add/edit a TBR book
      place-modal.js    add/edit a library or a bookstore

  ui/
    dom.js            el(), escapeHtml(), iconButton(), focus trap
    modal.js          shared open/close/backdrop/Escape/focus behaviour
    sheet.js          bottom-sheet behaviour, built on modal.js
    chips.js          the selectable-chip control
```

## Navigation

Hash routes (`#/`, `#/finished`) — no server rewrite rules, so this stays
deployable to GitHub Pages unchanged, and Phase 11's `#/club/<code>` already
has a matcher waiting for it.

Both routes mount once at boot and stay mounted, re-rendering from the store
whether or not they're the visible tab. `router.js` owns the three things every
route change must do — swap which section is visible, restore that route's
scroll position, and move focus to its heading — so no route has to remember
them. The tab is never persisted: a cold start always lands on Reading, but a
pasted `#/finished` link still opens Finished.

## Saved places

Libraries and bookstores are the same thing — a name, a link, add/edit/remove —
so they share `places.js` and `place-modal.js` rather than existing as two
near-identical files. Each section supplies its own hooks by data attribute
(`data-place-list`, `data-place-add`, `data-place-empty`) and its own store
actions, which is all that differs between them.

## Vibes

The vibe vocabulary lives in `MOOD_GROUPS` in `finish-modal.js`. Vibes you type
yourself are **not** stored in their own list — `customMoods()` reads them back
off the books that carry them. That's why adding one needs no migration, and
why the Finished filters can derive their chips from the data rather than from
a fixed list.

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
5. Bump **both** numbers, every deploy:
   - `BUILD` in `sw.js` — what invalidates the old cache. Enforced by the
     pre-push hook.
   - `APP_VERSION` in `js/main.js` — the footer stamp. `0.<phase><release>`:
     phase 2 shipped as `0.2`, its next release is `0.21`, finishing phase 3
     resets to `0.3`. Phase 7 makes it `1.0`.

   The footer shows both (`0.21 · build 19`). The build is read from the cache
   the service worker actually installed, so it's the one that can't be stale
   or forgotten — which is what makes "did the fix reach my phone?" answerable.

## The pre-push hook

`.githooks/pre-push` blocks any push that changes a file listed in `sw.js`'s
`ASSETS` without raising `BUILD`. Forgetting that bump ships an app that never
updates itself, and nothing on screen reveals it — hence a hook rather than a
habit. Docs-only pushes (`plan.html`, `spec.html`, this file) are unaffected,
since they aren't precached.

Hooks are not installed by cloning. In a fresh clone, run once:

```sh
git config core.hooksPath .githooks
```

Override for a single push with `git push --no-verify`.

## Updates

Updates apply themselves: the service worker calls `skipWaiting()` on install
and `clients.claim()` on activate, and the page reloads once on
`controllerchange`. `main.js` re-checks on every return to the foreground, and
holds the reload while a modal is open or a field has text in it, so an update
never lands on top of someone mid-sentence. There is nothing to tap.
