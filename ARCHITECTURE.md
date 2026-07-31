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

api/                  the ONLY backend — a Cloudflare Worker. Not precached,
                      not served by Pages, deployed separately. See api/README.md

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
    recommend.js      "find me something" — the ask, and the anti-invention pass
    series.js         asks the Worker what series a book is in, and the rules
                      for what finishing a volume does next

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

**Only the formats you'd borrow.** `borrowFormats` defaults to `['ebook']`,
because an "available now" you'd never take is worse than no answer — it buries
the copy you would take behind one you wouldn't. Piranesi at King County is the
case that proved it: the audiobook is on the shelf while the ebook is a six-week
wait, and sorting by availability alone answered a question nobody asked. The
chosen formats are part of the availability cache key, not just the query, so
switching back finds the previous answers still there.

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

Genre comes from either source and arrives with the search response, so a book
is complete when you pick it and picking one waits on nothing. Series *used* to
come only from Open Library, and still falls back to it — but the real answer
now comes from the Worker. See **Series** below for why.

Open Library's `subject` list is why the search asks for a field that triples
the payload (~3KB → ~8KB for six results). It earns it:

- **Series** arrives as a tagged subject — `series:The Wheel of Time`. The
  `series` *field* is not worth asking for: it is accepted and comes back absent
  for every doc, including Stormlight, Mistborn, Wheel of Time, Harry Potter and
  Dune. (Series does exist on individual *edition* records, but they disagree
  with each other — one Mistborn work names four different series across its
  editions — and reading them costs a second request per book.) `parseSeries()`
  reads these and is right about a third of the time, which is why it survives
  as a free fallback and why it is not the source of truth — see **Series**.
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

## Series

A series is one thing you are reading, not seven separate things.

**Why the catalogue can't do this.** Seventeen fantasy series titles were
queried against Open Library search on 2026-07-30. **6 of 17** carried a
`series:` subject tag at all; **0 of 17** carried a position number. Worse than
sparse, it is inconsistent *within* a series — *The Way of Kings* is tagged
Stormlight Archive, *Words of Radiance* is not — and the names disagree with
themselves ("The Mistborn Saga", "Red Rising Trilogy",
`A_Court_of_Thorns_and_Roses`). Open Library cannot answer *is this in a
series*, *where in it*, or *what comes next*.

So it is asked of the Worker (`POST /series`, Haiku) **once, at add time**, for
the **whole series** — every volume in publication order, each checked against
Open Library — and cached on the book. Add time because there is already a round
trip and a moment of waiting there. `parseSeries()` stays as the free fallback
for when the Worker can't be reached.

**Ask for the series, never for "the next book".** The first version asked what
came after each volume, one at a time. Getting a reader from book 1 to book 7
then needed six consecutive correct answers, each an independent guess, and one
wrong answer anywhere ended the series three books in with nothing on screen to
say why. It failed exactly that way on Throne of Glass: asked about *Heir of
Fire*, the model answered *Crescent City* — Sarah J. Maas wrote both.

Holding the list instead means `nextVolume()` is array indexing over data the
book already carries: no chain to break, no per-volume guess, no network when a
volume is finished, and a wrong answer visible at book 1 instead of book 3.

It also makes the answer **checkable**. The model is not asked where the book
sits — the position is derived by finding the queried title in the list it
returned, so a list that doesn't contain the book we asked about is
self-evidently about a different series and is thrown away. That single check
catches the Crescent City class of error without knowing anything about either
series.

Every volume travels on every volume, which is redundant on purpose: it is what
makes advancing local, offline and instant, and it costs a few KB on a long
series.

**Nothing new is stored.** A series entry is a normal book carrying series
fields. The grouping — in Current Reads and in the record alike — happens at
paint time off `seriesKey`, so sync, export, migration, search, the filters and
the recommender's exclusion list all keep operating on individual books and
never learn that series exist. If the grouping is wrong it is wrong on screen
for one render, not wrong in the reader's data.

**On Current Reads there is no grouping at all, and none is needed.** Finishing
a volume *advances the entry in place* (`finishCurrent(index, { next })`) rather
than adding a second one, so a series holds exactly one slot at every volume and
the cap of three never has to know series exist.

**In the record, grouping is real** — seven volumes render as one row — but each
volume keeps its own date and feeling inside it, and anything that *counts* what
you've read counts volumes. "Seven books this year" is the true answer and it is
the whole promise of the app.

**Filtering ungroups.** The moment a filter or a search is on, the record drops
back to one row per volume. Grouping is a browsing convenience; asking a
question deserves a literal answer, and it keeps the count honest with no
special case.

Rules in `nextVolume()` (`services/series.js`) that are not negotiable:

- **"Not for me" never advances a series.** Being handed book 2 of something you
  just gave up on is the app arguing with you. `setDownCurrent()` simply never
  advances, which covers both outcomes — a pause is a pause, and the book goes
  back on the pile at the volume it was on.
- **A re-read re-triggers nothing.** Finishing a volume already in the record
  advances nothing.
- **Nothing is added that the reader already has.** A next volume already in the
  record is skipped and the one after it offered; one already on the TBR pile is
  promoted rather than duplicated.
- **An unverified volume is never offered.** Open Library couldn't confirm it
  exists, so the series stops there rather than handing over a possible
  invention. Unverified volumes stay *in* the list — positions have to be
  stable — they just aren't advanced onto.
- **Failure is silence.** No series data, no answer, Worker down, offline — the
  app behaves exactly as it did before this existed. A reader who finishes a
  standalone must never see "couldn't find a next book".

**Announced, never silent.** The finish modal names the next volume before it
happens, with one tap to refuse it. That announcement is the correction point,
and it is what makes an occasionally-wrong answer survivable. `seriesDetached`
is the reader saying stop: it marks the copies still *ahead* of them, on Current
Reads and the pile, and deliberately leaves the record alone — detaching says
"this isn't a series to me going forward", not "un-group the seven books I
already read".

`SERIES` in `book-shape.js` is the feature flag for all of it. It lives there
rather than beside the network code because the store, the record and Current
Reads all have to ask "is this on?" and none of them should have to import a
module that can make a request to find out.

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
`removeBookstore`, `setVibe`, `setBorrowFormats` and `resetAll`, plus the
lifecycle calls `init`, `reloadLocal`, `applyRemote` and `setCloudSave`.

`applyRemote` and `reloadLocal` commit **without** persisting — state that came
*from* storage must not be written straight back.

## Invariants

These used to live as long comments in the code. Phase 8 moved them here to get
the shipped JavaScript under budget; the rules did not change, and breaking any
of them fails quietly rather than loudly.

> **Why the code is lightly commented, and where the prose went.** There is no
> build step, so every byte of comment is a byte shipped to a phone. The spec
> budget is 150 KB of JavaScript uncompressed; the fully-commented source was
> 232 KB, and 101 KB of that was prose. Phase 8 cut the commentary to a short
> header per module and moved the reasoning here, which is served but never
> precached and never parsed by the app.
>
> So: **if you find yourself writing more than a few lines of comment, it
> probably belongs in this file.** Keep in the code only what someone editing
> that specific line needs to not break it.

### The index invariant

Almost every action identifies a book by its **position** in a list —
`removeFinished(index)`, `readAgain(index)`, `removeTbr(index)`,
`finishCurrent(index)`. Those positions are captured in render closures, and
they are only ever correct because of one rule:

> **`commit()` notifies synchronously, and every listener re-renders in place.**

That is what guarantees a button can't outlive the list it was drawn from. A
remote snapshot arriving mid-session re-renders too, so a handler holding a
stale index is destroyed before anyone can tap it.

Break that — batch renders into a `requestAnimationFrame`, debounce a listener,
put a diffing layer in front of the DOM — and every action starts removing the
wrong book, silently. `bookKey()` is the real identity and is already stamped on
every row as `data-book-key`; that is where to go if this ever needs to stop
being positional.

**A promise across a confirmation is the same hazard.** `confirm()` blocked, so
the code after it could still hold an index. `ui/dialog.js` does not — anything
can change while it is open. A caller must re-resolve the target by `bookKey`
after the answer arrives; `current-reads.js` does exactly this, and is the
worked example.

### Books

- **Absent fields are omitted, never `null` or `''`.** A book the search knew
  nothing about must be indistinguishable from a hand-typed one, so "no cover"
  is a missing key everywhere rather than an empty frame to render.
- **`bookKey()` is the Open Library work id, or `title|author`.** Google Books
  results deliberately carry no `workKey` — their volume ids are a different
  namespace, and setting one would mean the same book from the two sources never
  recognising itself.
- **Clean objects are built where books are created**, not in `migrate()`.
  Entries pass through migration untouched on purpose: the record still holds
  legacy `notes` and `rating` fields, and a normaliser that only knew the current
  shape would quietly eat them.

### Deliberate non-destruction

- Anything displaced from Current Reads goes back on the **TBR pile** rather than
  vanishing. Quietly deleting a part-read book is the most destructive thing this
  app could do.
- `removeCurrent` writes nothing to the record — it is for a mis-add or a wrong
  edition, and is deliberately *not* the same as finishing or setting down.
- `readAgain` strips the finish metadata on the way to the pile, so the TBR entry
  is a book again rather than a half-erased memory of finishing it.
- **Import can only add.** See `state/merge.js`; the merge is additive precisely
  because it syncs, and a merge that could delete would delete everywhere.

### Rendering state that outlives its own render

`finished-list.js` holds two module-level sets — `flashing` (rows whose "Read
again" was just tapped) and `expanded` (open series rows). They live outside the
render because the action that sets them commits to the store, which re-renders
the list and destroys the button that was tapped about a millisecond later.
Holding that state in the render is the only version that survives its own side
effect. `flashing` is keyed per *entry* (`bookKey|finishedAt`), not per book,
because the same title legitimately appears in the record more than once.

### Escape closes one layer

Every open modal registers its own document-level `keydown`. Without the
topmost-layer check in `ui/modal.js`, a modal opened from the settings sheet
would take the sheet down with it.

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
  vibe:         'cottage' | null,        // preference, not content
  borrowFormats: ['ebook']               // preference, not content
}

// Book — everything past `title` is optional and ABSENT when unknown, never
// null or ''. A hand-typed book is just a Book that knows two things.
{ title, author,
  source,                                    // 'openlibrary' | 'google-books'
  workKey, coverId,                          // Open Library only
  googleId, coverSrc,                        // Google Books only (coverSrc is a URL)
  year,
  seriesKey, seriesName, seriesPosition,     // from POST /series, or parsed off
  seriesTotal,                               //   a `series:` subject as fallback
  seriesVolumes,                             // [{ title, verified, author?,
                                             //   workKey?, coverId?, year? }]
                                             //   every volume, publication order
  seriesDetached,                            // the reader said stop. See below
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

## The backend (`api/`)

One Cloudflare Worker, two routes (`POST /recommend`, `POST /series`), deployed
independently of the site. It exists because the Anthropic API key must never
reach a browser and a static site has nowhere else to put it. Everything else in
this app still has no backend.

The two routes are metered differently on purpose. A recommendation is *asked
for*, so it spends a credit from a cap the reader is told about. A series lookup
happens because someone added a book, so its counter is an abuse ceiling: never
surfaced, its own generous cap, its own key prefix (`s:` rather than `q:`), and
charged only on a cache miss — which is what makes "the second reader to add
this book costs nothing" true rather than merely cheap.

`api/README.md` is the operational doc — deploy, key rotation, cost levers.
Three decisions there are load-bearing and are each guarded by a test:

- **The user id comes from the verified Firebase token, never the request body.**
  A caller can put any uid in the JSON they post; it changes nothing.
- **The quota credit is claimed *before* the model call.** KV has no
  transactions, so check-then-call-then-increment lets two concurrent requests
  both pass a check only one should — and what's protected is a real bill.
- **`effort` is pinned to `low` on `/recommend`, and absent on `/series`.**
  Opus 5 thinks by default and thinking bills as output; unpinned costs several
  times pinned. Even pinned, a measured call cost 10¢ — mostly thinking.
  `/series` runs on Haiku 4.5, which does not think and **rejects
  `output_config.effort` with a 400** — adding it there to "match" `/recommend`
  would break every request. `api/README.md` carries the real numbers; if you
  change a model or an effort, **measure again rather than estimating**. The
  first estimate there was wrong by 3–4× and estimates of this are not reliable.

The Worker writes no logs. Two integers per reader per UTC day in KV, expiring
after 48 hours, are the entire record it keeps of anyone. The series cache
alongside them holds no reader in it at all — it is keyed by title and author
and shared by everyone.

## Updates

Updates apply themselves: the service worker calls `skipWaiting()` on install
and `clients.claim()` on activate, and the page reloads once on
`controllerchange`. `main.js` re-checks on every return to the foreground, and
holds the reload while a modal is open or a field has text in it, so an update
never lands on top of someone mid-sentence. There is nothing to tap.
