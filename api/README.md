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
day it is not. Two levers, both one line:

- **`DAILY_CAP`** in `wrangler.toml` — fewer asks per reader per day.
- **`MODEL`** in `src/recommend.js` — `claude-haiku-4-5` is about a fifth the
  cost and recommends noticeably less well.

**Set a billing alert on the Anthropic account before anyone but you uses this.**

### `/series` is the cheap one, and stays cheap

`claude-haiku-4-5`, a ~60-token prompt, six short fields back, and **no
`effort`** — Haiku 4.5 doesn't think and *rejects* `output_config.effort` with a
400, so the pin that is load-bearing in `recommend.js` would be a bug here.
Well under a tenth of a cent per ask.

What actually keeps the bill near zero is the cache. A verified answer is stored
in KV with **no TTL**, keyed by normalised title + author and shared by every
reader, so the first person to add *The Way of Kings* pays for everyone who ever
adds it after. Hit rate approaches 100% for anything popular.

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
anywhere. A test asserts the absence. `wrangler tail` shows request metadata
only — if you add logging while debugging, take it out again.

## The four things not to "simplify"

1. **The uid comes from the verified token, never the request body.** A caller
   can put any user id they like in the JSON they post; it changes nothing.
   There is a test named after this.
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

## Files

```
wrangler.toml     config, KV binding, the daily cap
src/index.js      the route: CORS, auth, quota, typed errors
src/firebase.js   ID token verification via JWKS + WebCrypto (no Admin SDK)
src/quota.js      counters per reader per day, in KV — one prefix per route
src/recommend.js  the model call — model id, effort pin, schema, prompt
src/series.js     the series lookup — Haiku, schema, Open Library check, cache
```

`src/firebase.js` is worth reading once. The Firebase Admin SDK doesn't run on
Workers, but it isn't needed: Google publishes the token-signing keys as JWKS in
exactly the shape WebCrypto's `importKey('jwk', …)` accepts, so verification is
a signature check and six claim comparisons with no dependencies at all.
