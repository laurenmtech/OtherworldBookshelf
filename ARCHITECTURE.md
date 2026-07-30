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
search-config.js      plain script; sets window.GOOGLE_BOOKS_KEY
manifest.webmanifest

styles/
  tokens.css          THE VIBE CONTRACT — every token, defaulting to Otherworld
  base.css            reset, page chrome, layout grid
  components.css      panels, cards, lists, buttons, chips, modals
  vibes/
    cottage.css  celestial.css  dark-academia.css  seaglass.css
    audit.mjs         contract + WCAG AA check; fails the build on a gap
    CONTRAST.md       generated audit results, per vibe

js/
  main.js             boot: init store, mount the shell, wire routes, register SW

  vibes/
    registry.js       id, name, blurb, fonts, status-bar colour
    apply.js          attribute + fonts + theme-color + local cache

  routes/
    router.js         hash routing, per-tab scroll, focus on change
    reading.js        #/          current reads + TBR
    finished.js       #/finished  the archive, with search and filters

  state/
    store.js          the single source of truth + subscribe()
    migrate.js        forward migrations, safe to re-run
    moods.js          the vocabulary: feelings, vibe groups, "set down"
    persist-local.js  localStorage adapter
    persist-cloud.js  Firestore adapter (live snapshot, saves, seeding)
    auth.js           Google sign-in, Firestore handle

  services/
    books.js          the search: merges the sources, ranks the result
    book-shape.js     what a Book is, and how one is recognised twice
    open-library.js   primary source — no key, stable work ids
    google-books.js   secondary source — needs a key, knows new releases
    libby.js          library links (unbreakable) + availability (optional)

  components/
    tab-bar.js        the two tabs; bottom bar on a phone, header links wide
    hidden-shelf.js   "The Hidden Shelf": card, places, record
    header.js         account controls + sync status (rendered in the sheet)
    current-reads.js  up to three current reads, first one large
    tbr-pile.js       what's next
    finished-list.js  the record — renders an already-filtered list
    places.js         saved places: libraries AND bookstores, one list impl
    typeahead.js      the book search combobox
    vibe-picker.js    the grid of live vibe cards
    modals/
      finish-modal.js   how was it? feeling + vibes
      set-down-modal.js not right now, or not for me
      book-modal.js     add/edit a book — TBR pile and Current Reads
      place-modal.js    add/edit a library or a bookstore

  ui/
    dom.js            el(), escapeHtml(), iconButton(), focus trap
    modal.js          shared open/close/backdrop/Escape/focus behaviour
    sheet.js          bottom-sheet behaviour, built on modal.js
    chips.js          the selectable-chip control
    mood-picker.js    the grouped vibe chips + "new vibe", shared by two modals
    book-meta.js      the line under a title, and the genre/format tags
    cover.js          cover art, or nothing — there is no placeholder
    reveal.js         scroll to and flash a book you already have
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

A library entry may also carry `libraryKey` and `officialName`. **That key is
the whole type system**: an entry with one is a real library on Libby and gets
borrow links and availability; an entry without one is a bookmark. There is no
`kind` field, because a redundant enum could disagree with the key and then
something would have to decide which was right.

`name` is *your* name for it — "Mom's card", "the good one" — and it's what the
app shows everywhere. `officialName` is kept underneath and surfaces only when
it differs, which is how two similarly-named entries stay tellable apart.
Renaming never touches the key.

Order matters: the **first** library with a key is the primary one, and the one
availability is checked against. So `reorderLibrary` is a store action, not a
view preference.

## Libraries and Libby

`services/libby.js` holds two things that must not be confused:

- **Deep links** — `libbyapp.com/search/<key>/…`, `share.libbyapp.com/title/<id>`,
  and Bookshop.org. Ordinary URLs built by string concatenation. Nothing can
  break these, and they are the actual product.
- **The catalogue API** — `thunder.api.overdrive.com`, the service Libby's own
  web app calls. Undocumented, unsupported, no compatibility promise. It is an
  enhancement, it fails silently, and its absence leaves no gap on screen.

Everything in the second category sits behind the `AVAILABILITY` flag. Turn it
off and every borrow row disappears; the links, names and prompts carry on
unchanged. Both failure paths are tested.

**You cannot search for a library.** `?query=seattle` is ignored — it returns
all 13,050 libraries, unfiltered. Verified against `query`, `search`, `q`,
`name`, `libraryName`, `keyword`, `nameQuery`, lat/long and `postalCode`; every
one returns the same list, `perPage` caps at 100, and there is no
`/libraries/search` endpoint. So adding a library works the other way round:
you give the key (or paste a Libby URL) and `/v2/libraries/<key>` gives the name
back to confirm. That confirmation is load-bearing — `austin` resolves to Austin
ISD, not Austin Public Library, and seeing the name is what makes that visible
instead of silent.

**Matching a book is by title text.** `media?query=<isbn>` returns nothing, so
the plan's ISBN mitigation doesn't exist. Consequences, all deliberate:
a matched title that differs from yours is shown, so a wrong edition is visible;
and "no match" is reported as *didn't find it*, never as *your library doesn't
have it*, because a text search missing something is not evidence of absence.

Availability is **not state** and never enters the store — it is true for
minutes, not days. It lives in a session cache in `libby.js`, capped at three
lookups in flight, and a late answer triggers a re-render of the TBR list and
nothing else. A cached `null` counts as an answer, so a failing endpoint is
asked once per book and then left alone.

## Vibes (the app's look)

Every vibe is one file declaring the same set of custom properties. Components
reference tokens and never a raw colour, so a vibe is ~30 lines rather than a
rewrite — `grep` for `#` or `rgba(` outside `styles/tokens.css` and
`styles/vibes/` should return nothing, and every hit is a bug.

Otherworld has no file of its own: it *is* `tokens.css`, so the default values
live in exactly one place and can't drift from a copy.

Each block is selected twice — `html[data-vibe="x"]` skins the app, and
`.vibe-scope[data-vibe="x"]` lets a picker card wear a vibe the page isn't
wearing. That's why the picker previews can never go stale: they are the
stylesheet, not a screenshot of it.

An inline script in `<head>` stamps `data-vibe` before the first paint —
otherwise a light vibe opens with a frame of black. It necessarily duplicates
the font URLs and theme colours from `registry.js` (no module has loaded yet);
a test asserts the two agree.

Webfonts are fetched only for the vibe being worn, except while the picker is
open, when all five load so the cards show their real faces.

Run `node styles/vibes/audit.mjs` after touching any of this. It fails on a
missing token or a pair below WCAG AA, and `--write` regenerates `CONTRAST.md`.

## Adding a book

Adding is search-first. `services/books.js` owns the network and
`components/typeahead.js` owns the combobox over it. Picking a result adds the
book in one tap, fully populated.

**Two sources, one list.** Open Library is primary: no key, permissive CORS, and
the stable work ids the whole shelf is keyed on. Its one real weakness is
recency — it carries some 2026 titles but lags the newest releases by months,
which are exactly the books someone is most likely to be reading. Google Books
covers that gap; publishers feed it before publication.

Both are queried at once and the results merged. Neither is allowed to be a
single point of failure in the direction that matters: Open Library failing is
an error the reader is told about, Google Books failing — no key, quota, a bad
referrer — is absorbed silently, because a secondary source must never take the
search down with it.

**Google Books needs a key, and the key is committed.** Keyless requests share
one global anonymous quota pool across everyone on the internet who calls
without one, and it is routinely exhausted (every keyless call tested returned
429, citing Google's own shared consumer project). The key in
`search-config.js` is public by design in the same way `firebase-config.js` is:
read-only, referrer-restricted to this site, restricted to the Books API, and
quota-capped. An empty key is a supported state — the source is simply off.

**Merging is by title+author, not by id.** A Google volume id and an Open
Library work id are different namespaces, so Google results deliberately carry
**no** `workKey` — claiming one would mean a book added from Google is never
recognised as the same book once Open Library catches up. Falling through to
`title|author` is what lets the two agree, and it is the same fallback
`bookKey()` uses for a hand-typed book. Open Library wins a merge because it
carries the work id; Google fills in only what Open Library left blank, which in
practice is the cover on a book too new to have one.

Four things about the search are load-bearing:

- **Debounce and supersession are different problems.** Debouncing keeps a fast
  typist to one request per pause; supersession is what stops a slow reply to
  "pir" repainting over a fast reply to "piranesi". Every request carries a
  sequence number and stale ones are dropped on arrival.
- **Missing fields are missing keys**, never `null` or `''`. A hand-typed book
  and a book the search knew nothing about have to be the same thing, so "no
  cover" is an absent key everywhere and never an empty frame to render.
- **Search must fail offline.** `sw.js` deliberately does not cache
  `openlibrary.org`, so the typeahead can say the search is unreachable and open
  the manual fields instead. Adding a book never depends on a network.
- **Results are scored against the query, and `edition_count` only breaks ties.**
  Sorting the whole set by `edition_count` — which the original plan called for
  — answers "dune" with *Peril at End House*, "educated" with *Democracy and
  Education* and "the way of kings" with the *Bible*: a heavily reprinted
  classic that matches loosely beats the book you typed. Open Library's own
  relevance is better but still puts *Children of Dune* above *Dune*. So
  `ranked()` scores each result on how well its title matches (exact, prefix,
  phrase) plus how much of the query is covered by title **and author**
  together, and only then falls back to `edition_count` and Open Library's
  order. Measured on sixteen known titles: 16/16 correct first result, against
  11/16 for raw relevance. The author half is what makes "piranesi clarke"
  work — neither word is a title match, so without it everything ties at zero
  and `edition_count` hands you *A Christmas Carol*.

## Genre and series

Series comes only from Open Library; genre comes from either. Both arrive with
the search response, so a book is complete when you pick it and picking one
waits on nothing.

Open Library's `subject` list is why the search asks for a field that triples
the payload (~3KB → ~8KB for six results). It earns it:

- **Series** arrives as a tagged subject — `series:The Wheel of Time`. The
  `series` *field* is not worth asking for: it is accepted and comes back absent
  for every doc, including Stormlight, Mistborn, Wheel of Time, Harry Potter and
  Dune. (Series does exist on individual *edition* records, but they disagree
  with each other — one Mistborn work names four different series across its
  editions — and reading them costs a second request per book.) Nothing displays
  series yet beyond the line under a title; Phases 6 and 8 are what need it.
- **Genre** is matched onto the fixed vocabulary in `GENRES` (in
  `book-shape.js`), at most two per book, ranked by how many strings vote for
  each. The structured `genre:` tag exists on only a small minority of works,
  and the raw list is unusable — it mixes real subjects with
  `nyt:hardcover-fiction=2010-09-19`, `Accessible book` and
  `Amerikanisches Englisch`. Google Books gives BISAC paths instead
  (`Fiction / Fantasy / Epic`); both are strings, so both go through the same
  vocabulary. A shelf wants a word you'd say out loud, not a catalogue heading.

Two patterns in `GENRES` are subtle and should not be "simplified":
`Science` carries a negative lookahead (without it every science fiction novel
is also tagged Science, because "hard science fiction" contains "science"), and
`Historical` and `History` are deliberately separate (Pride and Prejudice is
tagged "Fiction, Romance, Historical, Regency" many times over and would
otherwise out-vote its way into being filed as History).

## Duplicates

Every row that renders a book stamps `data-book-key` (`bookKey()` — the Open
Library work id when there is one, `title|author` otherwise, so a hand-typed
book still matches the search result for it). That is all `ui/reveal.js` needs
to scroll to a book and flash it, without any list exposing its internals.

A duplicate is a **note, not a rule**: the modal says where the book already is
and offers to go there, and saving a second time adds it anyway. Two editions of
one book is a real thing.

## Vibes (the ones on a book)

The vibe vocabulary lives in `state/moods.js` — it moved out of
`finish-modal.js` in Phase 4, when "set it down" started asking the same
question and the grouped chips became `ui/mood-picker.js`. Vibes you type
yourself are **not** stored in their own list — `customMoods()` reads them back
off the books that carry them. That's why adding one needs no migration, and
why the Finished filters can derive their chips from the data rather than from
a fixed list.

`SET_DOWN` lives there too, and is the one member of the feeling facet that
isn't a feeling: it's read off the `setDown` flag rather than the `feeling`
field, so a book you stopped reading without saying how it felt still answers
to that chip.

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

Actions: `addCurrent`, `editCurrent`, `reorderCurrent`, `finishCurrent`,
`setDownCurrent`, `addToTbr`, `editTbr`, `removeTbr`, `makeTbrCurrent`,
`removeFinished`, `addLibrary`, `editLibrary`, `removeLibrary`,
`reorderLibrary`, `makeLibraryCurrent`, `addBookstore`, `editBookstore`,
`removeBookstore`, `setVibe` and `resetAll`, plus the lifecycle calls `init`,
`reloadLocal`, `applyRemote` and `setCloudSave`.

`applyRemote` and `reloadLocal` commit **without** persisting — state that came
*from* storage must not be written straight back.

## Data shape

```js
{
  currentReads: [ Book ],   // capped at 3 — see CURRENT_CAP. ORDER MATTERS:
                            // the first entry is the one rendered large
  wishlist:     [ Book ],   // kept sorted by title
  finished:     [ Book & { finishedAt, feeling, moods[], setDown? } ],
  library:      [ { name, url, libraryKey?, officialName? } ],  // ORDER MATTERS:
                            // the first entry WITH a key is the primary library
  bookstores:   [ { name, url } ],
  vibe:         'cottage' | null         // preference, not content
}

// Book — everything past `title` is optional and ABSENT when unknown, never
// null or ''. A hand-typed book is just a Book that knows two things.
{ title, author,
  source,                                    // 'openlibrary' | 'google-books'
  workKey, coverId,                          // Open Library only
  googleId, coverSrc,                        // Google Books only (coverSrc is a URL)
  year,
  seriesKey, seriesName, seriesPosition,     // when a `series:` subject says so
  genres,                                    // at most two, from GENRES
  format }                                   // 'print' | 'ebook' | 'audio'
```

`migrate.js` normalises anything loaded or received: unknown *top-level* keys
are dropped, missing keys get empty defaults, and it is safe to run twice — it
runs on every load *and* every remote snapshot. Shape v5: `current` →
`currentReads[]`, then `bookstores`, then `vibe`, then the optional book fields
above.

Entries themselves pass through **untouched**, deliberately: the record still
holds legacy `notes` and `rating` fields that the Finished list renders, and a
normaliser that only knew about the current shape would quietly eat them. Clean
objects are built where books are *created* (`services/books.js`) instead.

`setDown` marks a book you stopped reading for good. Phase 8's suggestions must
exclude those; nothing else may read the flag.

**`isEmptyState()` counts content only.** It decides whether a remote snapshot
is real enough to replace what's on this device, so a document holding nothing
but a preference must never qualify — otherwise signing in on a second device
could let "I like the Cottage vibe" wipe a shelf that hadn't synced yet. If you
add a preference to the state, it does not belong in that function.

The legacy `current` mirror that `toStorage()` used to write alongside
`currentReads` is **gone** as of Phase 4: with three current reads it could only
ever describe one of them, and a client old enough to need it would write the
other two away on its next save. `toCurrentReads()` still *reads* `current`, so
a v1 document is still understood — it just isn't written back.

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
     phase 2 shipped as `0.2`, its next release is `0.21`, finishing phase 4
     resets to `0.4`. Phase 7 makes it `1.0`.

   The footer shows both (`0.21 · build 19`). The build is read from the cache
   the service worker actually installed, so it's the one that can't be stale
   or forgotten — which is what makes "did the fix reach my phone?" answerable.

## The pre-push hook

`.githooks/pre-push` blocks any push that changes a file listed in `sw.js`'s
`ASSETS` without raising `BUILD`. Forgetting that bump ships an app that never
updates itself, and nothing on screen reveals it — hence a hook rather than a
habit. Docs-only pushes (this file, `README.md`) are unaffected, since they
aren't precached.

Cover art (from `covers.openlibrary.org` and `books.google.com`) is the one
thing cached **outside** the build cache, in `otherworld-reads-covers`, and it
survives `activate` on purpose: a cover id is immutable, so re-downloading every
one of them on each deploy would be the most expensive thing this app does for
no gain. The responses are opaque — an `<img>` is a no-cors request, so
`res.ok` is false and `res.status` is 0 — which is why that handler stores a
response it cannot read.

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
