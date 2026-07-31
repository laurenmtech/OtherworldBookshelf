# Otherworld Bookshelf

A private reading shelf, so you remember what you read.

If you read on a Kindle, no cover ever sits on a shelf and the titles go. This
gives them back — so there's an answer when someone asks what you've read
lately.

**Live app:** [laurenmtech.github.io/OtherworldBookshelf](https://laurenmtech.github.io/OtherworldBookshelf)
— open it on a phone and add it to your home screen; it works offline and looks
like an app rather than a page.

## What it does

- **Search and add in one tap.** Type a title, pick it, done — cover, author,
  year, genre and series all arrive filled in.
- **Up to three books at once**, because reading three things at a time is
  normal.
- **Finish one, or set it down.** Setting a book down isn't failure — it's
  either "not right now" (back on the pile, no mark against it) or "not for
  me" (into the record, and never suggested again).
- **Series travel together.** Finish a volume and the next one is already
  there, announced rather than silently substituted, taking one slot however
  long the series runs.
- **A TBR pile with somewhere to go.** Each book carries a checkout link to
  your library or your bookshop — and, where Libby can tell us, whether it's
  available and how long the wait is.
- **A record you can search and filter** by how a book felt and the words you
  used about it.
- **"What should I read?"** — suggestions built from your own taste, every one
  checked against a real catalogue so nothing invented gets through.
- **Five looks**, switchable any time, each one a complete theme.

## Your data

Nothing is shared. No feed, no followers, no ratings anyone else sees.

Your shelf lives in your browser and works fully offline. Sign in and it also
syncs to your own Firestore document, so it follows you between devices — that
is the only thing signing in does.

The recommender is the one feature that talks to a server, and it sends a short
summary of your taste — a handful of loved titles and the words you reach for —
never your shelf. Series lookups send one book's title and author and nothing
else. The backend keeps no record of any of it: no logs, no prompts, no titles,
just a per-day request counter that expires after 48 hours.

You can export the whole shelf as JSON at any time, import one back (it merges,
and never overwrites what's already there), or delete everything.

## Running it yourself

No build step and no dependencies — it's ES modules and plain CSS.

```sh
git clone https://github.com/laurenmtech/OtherworldBookshelf.git
cd OtherworldBookshelf
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` as a file won't work:
ES modules, the service worker and sign-in all need a real origin. `localhost`
counts as secure, so everything behaves exactly as it does in production.

**It runs with no setup at all** — search, the shelf, offline, and all five
vibes work out of the box. The optional pieces:

| Want | Needs | Where |
|---|---|---|
| Sync between devices | A free Firebase project | `firebase-config.js` |
| Newly published books in search | A Google Books API key | `search-config.js` |
| "What should I read?", and series | The Worker deployed | `api/README.md` |

Both config files are committed on purpose and hold no secrets — the comments
in each explain why that's safe. Without them the app simply does less; nothing
breaks.

## Deploying

Push to `main`. GitHub Pages serves the repo root as-is.

A git hook (`.githooks/pre-push`) runs the tests and the contrast audit, and
enforces one rule: **if you change a file listed in `ASSETS` in `sw.js`, raise
`BUILD` in the same commit.** The service worker serves the
app shell cache-first, and that counter is the only thing that invalidates it —
forget it and every installed phone keeps running the old code silently, with
nothing on screen to say so.

The backend is separate and deploys on its own; see `api/README.md`.

## The code

- `index.html` — all the markup
- `styles/` — `tokens.css` is the vibe contract; `vibes/` are the five themes
- `js/` — ES modules: `state/` (the store), `services/` (search, Libby, the
  recommender, series), `components/`, `ui/`
- `api/` — the Cloudflare Worker, the only backend
- `ARCHITECTURE.md` — where things live, how state flows, and why the
  non-obvious decisions are the way they are

`ARCHITECTURE.md` is the one worth reading before changing anything.
