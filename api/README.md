# The backend

One Cloudflare Worker, two routes. It exists for a single reason: the Anthropic
API key must never reach a browser, and a static site on GitHub Pages has
nowhere else to put it.

```
POST /recommend
Authorization: Bearer <Firebase ID token>
{ moods[], freeText, tasteSummary, exclude[] }
  → { suggestions: [{ title, author, why }], remaining }

POST /series
Authorization: Bearer <Firebase ID token>
{ title, author }
  → { series: null }
  → { series: { key, name, position?, total?, next? } }
```

Deployed independently of the site. The app works completely without it. If this
is down: the recommender disappears from the frontend entirely rather than
offering something that fails, and series lookups fall silent — books still add,
still finish, and simply don't hand you the next volume.

## What it costs

`claude-opus-5` with **effort pinned to `low`** in `src/recommend.js`. That pin
is load-bearing: Opus 5 thinks by default and thinking tokens bill as output, so
an unpinned request costs several times a pinned one.

**Measured, not estimated.** The first real call cost **$0.10**. Input was only
~400 tokens; the rest is thinking, which bills as output — `effort: low` bounds
it, it doesn't remove it. Trust this number over any arithmetic:

| | per ask | one reader at the full 10/day |
|---|---|---|
| Opus 5, effort `low` (current) | **~10¢ (measured)** | **~$30/month** |
| Haiku 4.5 | ~2¢ (est.) | ~$6/month |

The earlier estimate here said ~2.8¢ and was wrong by 3–4×, because it assumed
~800 output tokens and the real figure is closer to 3,900. If you change the
model or the effort, re-measure rather than re-deriving.

At a realistic few asks a week this is small change. At the full allowance every
day it is not. Three levers, all of them **config in `wrangler.toml`** — a
change and a `wrangler deploy`, never an edit to a source file:

- **`DAILY_CAP`** — fewer asks per reader per day.
- **`MODEL`** — `claude-haiku-4-5` is about a fifth the cost and recommends
  noticeably less well. The effort pin follows the model automatically
  (`EFFORT_MODELS` in `src/recommend.js`): Haiku 4.5 rejects
  `output_config.effort` with a 400, so a swap that still sent the pin would
  fail on every ask.
- **`MONTHLY_BUDGET_USD`** — the ceiling across every reader, below.

**Set a spend limit on the Anthropic account before anyone but you uses this.**
Console → Settings → Workspaces → the workspace holding this Worker's key →
spend limit, plus a notification below it. That limit is the backstop, and the
reason it matters is that it does not depend on anything in this repo being
correct.

### The month's ceiling

`MONTHLY_BUDGET_USD` is a running total of what the month has cost, checked
before each recommendation. Past it, `/recommend` returns a typed
`budget_exhausted` (503) and the app says *"The recommender is resting until the
1st."* in one sentence. Nothing else changes: books add, finish, and find their
series exactly as before.

Three things about it are deliberate:

- **The check comes before the daily claim.** A reader turned away by the budget
  has not had an ask, and doesn't lose one of their ten to it.
- **Series lookups are recorded but never gated.** The ledger says what the
  month cost, so leaving the Haiku calls out would make it a lie — but a reader
  adding a book isn't asking for anything, and the app must not start failing at
  it because a *recommendation* budget ran out.
- **An unset or unparseable figure means no ceiling.** A config typo should not
  take the feature off the air; that is what the account-level limit is for.

It is a strong nudge, not an enforced cap. The cost of an ask isn't knowable
until the response reports its tokens, so the ceiling is crossed by one ask
rather than stopped at it, and — like the daily counters — the ledger is
read-then-write with nothing holding the two together, so simultaneous asks can
lose an increment. The overshoot is cents.

### Reading what the month has cost

One KV key, no endpoint, no dashboard:

```
npx wrangler kv key get --remote --binding QUOTA "m:$(date -u +%Y-%m)"
```

The number is **micro-dollars** — divide by a million. There is deliberately no
route that serves it: an admin endpoint would need an admin identity, and this
Worker doesn't have one and is better for it.

### `/series` is the cheap one, and stays cheap

`claude-haiku-4-5`, a ~60-token prompt, six short fields back, and **no
`effort`** — Haiku 4.5 doesn't think and *rejects* `output_config.effort` with a
400, so the pin that is load-bearing in `recommend.js` would be a bug here.
Well under a tenth of a cent per ask.

What actually keeps the bill near zero is the cache. A verified answer is stored
in KV with **no TTL**, keyed by normalised title + author and shared by every
reader, so the first person to add *The Way of Kings* pays for everyone who ever
adds it after. Hit rate approaches 100% for anything popular.

**One lookup fills the whole series.** The key is per *title*, so a reader
adding seven Throne of Glass books used to pay for seven Haiku calls and
forty-nine Open Library checks — and gave the model seven independent chances to
be wrong. Asking for the whole list removed the *chain*; it did not remove the
per-book retry. But a verified list already answers for every title in it: the
list is the same list and the position is the index. So `fanOut()` writes an
entry for every verified volume, and the seven books cost **one call and seven
checks**. The second volume anyone adds never reaches the model.

Two limits on that, both deliberate: only **verified** volumes get an entry of
their own — writing a permanent entry that asserts an unconfirmed book is real
is the invention this route refuses everywhere else — and entries are keyed by
the volume's **catalogue** author, which is what a client that found the book
through search sends back. A book typed by hand with no author misses and pays
for a lookup, exactly as before.

`SERIES_DAILY_CAP` in `wrangler.toml` is the ceiling, and it is *not* an
allowance — nothing ever shows it to anyone. Adding a book fires a lookup
without anyone asking for one, so spending a recommendation credit on it would
mean a reader who adds ten books quietly loses their recommendations for the
day. It exists so a stolen token can't run up a bill. Cache hits don't count
against it.

**A wrong answer cached with no TTL is permanent**, which is why
`CACHE_VERSION` exists in `src/series.js`: bump it and the entire cache is
abandoned in one edit. What gets cached forever is deliberately narrow — see
`cachePolicy()`, which gives a 30-day TTL to anything that could become wrong
(a standalone whose author later writes a sequel; a last volume that gets one)
and caches *nothing at all* when Open Library couldn't be reached to check.

## Deploying

You need a Cloudflare account (the free tier covers this) and an Anthropic API
key. Then, from this directory:

```sh
npm install
npx wrangler login

# One KV namespace, for the per-reader daily counters and the series cache.
npx wrangler kv namespace create QUOTA
# → paste the printed id into wrangler.toml under [[kv_namespaces]]

# OPTIONAL: give the series cache a namespace of its own, so QUOTA holds
# nothing but counters. src/series.js prefers SERIES and falls back to QUOTA,
# so this is a pure upgrade with no code change.
#   npx wrangler kv namespace create SERIES
# → uncomment the SERIES block in wrangler.toml and paste the id

# The API key. A secret, not a var — it is never written to this repo.
npx wrangler secret put ANTHROPIC_API_KEY

npx wrangler deploy
```

`wrangler deploy` prints the Worker URL. That URL is what the frontend needs.

### Checking it works

Unauthenticated calls must fail. This should return `401` with
`{"error":{"type":"unauthenticated",…}}`:

```sh
curl -i -X POST https://<your-worker-url>/recommend \
  -H 'Origin: https://laurenmtech.github.io' \
  -H 'content-type: application/json' \
  -d '{"moods":["Cozy"]}'
```

For a real call you need a Firebase ID token — sign in to the app, then in the
browser console:

```js
await firebase.auth().currentUser.getIdToken()
```

## Rotating the API key

```sh
npx wrangler secret put ANTHROPIC_API_KEY   # paste the new key
```

Takes effect on the next request; no redeploy needed. Revoke the old key in the
Anthropic console **after** confirming a call succeeds. If a key is ever
exposed, revoke first and accept the downtime — a leaked key spends real money.

## What it stores about anyone

Two integers per reader per UTC day — one for recommendations (`q:`), one for
series lookups (`s:`) — keyed by their Firebase user id, expiring after 48
hours. That's the whole record.

The series cache (`series:v1:…`) sits in the same namespace and holds no reader
in it at all: it is keyed by a book's title and author, its value is a fact
about that book, and it is shared by everyone. Nothing in it says who asked.

There are no `console.log` calls in the Worker, deliberately: no prompt, no
mood, no book title, no suggestion and none of a reader's own words are written
anywhere. `tests/worker.test.mjs` asserts the absence — it fails on any
`console.` call in `src/`. `wrangler tail` shows request metadata
only — if you add logging while debugging, take it out again.

## The four things not to "simplify"

1. **The uid comes from the verified token, never the request body.** A caller
   can put any user id they like in the JSON they post; it changes nothing.
   `tests/worker.test.mjs` posts a `uid` in the body and asserts a 401.
2. **The quota credit is claimed *before* the model is called.** KV has no
   transactions, so a check-then-call-then-increment lets two concurrent
   requests both pass a check only one should — and what's being protected is a
   real bill. A failed call refunds, best-effort.
3. **CORS echoes the origin only when it's allowed.** A wildcard would let any
   website spend a signed-in reader's daily quota from their browser.
4. **A claimed next volume is verified against Open Library before it is
   returned.** Structured output guarantees the *shape* of an answer, never its
   truth. An unverifiable sequel is dropped, and — separately — a verification
   that *couldn't run* is never cached, so one unreachable minute doesn't
   become a permanent wrong answer.

## Tests

```sh
node tests/run.mjs      # from the repo root — covers the client and this Worker
```

No dependencies and no config. The Worker tests run the real `fetch` handler
against a fake KV and deliberately malformed tokens, so nothing here touches the
network.

## Files

```
wrangler.toml     config: KV binding, the caps, the model, the month's budget
src/index.js      the route: CORS, auth, quota, budget, typed errors
src/firebase.js   ID token verification via JWKS + WebCrypto (no Admin SDK)
src/quota.js      counters per reader per day, in KV — one prefix per route
src/budget.js     the month's spend: token prices, one total, the ceiling
src/recommend.js  the model call — model id, effort pin, schema, prompt
src/series.js     the series lookup — Haiku, schema, Open Library check, cache
```

`src/firebase.js` is worth reading once. The Firebase Admin SDK doesn't run on
Workers, but it isn't needed: Google publishes the token-signing keys as JWKS in
exactly the shape WebCrypto's `importKey('jwk', …)` accepts, so verification is
a signature check and six claim comparisons with no dependencies at all.
