// "What series is this book in, and what are all of its volumes?"
//
// This route exists because the catalogue can't answer the question. Seventeen
// fantasy series titles were queried against Open Library on 2026-07-30: 6 of 17
// carried a `series:` subject tag at all, 0 of 17 carried a position number, and
// the tagging is inconsistent *within* a series — The Way of Kings is tagged
// Stormlight Archive, Words of Radiance is not. So series order is asked of a
// model once, verified against the catalogue, and then cached forever.
//
// ── Why the WHOLE series, and not just the next volume ──────────────────────
// The first version of this asked "what comes after this book?", one book at a
// time. Getting a reader from book 1 to book 7 then needed six consecutive
// correct answers, each an independent guess, and one wrong answer anywhere
// ended the series three books in with nothing on screen to say why. It failed
// in exactly that way on Throne of Glass: asked about Heir of Fire, the model
// answered "Crescent City" — Sarah J. Maas wrote both — and the chain died.
//
// Asking for the whole list once replaces six chances to be wrong with one, and
// makes that one chance CHECKABLE: a list that doesn't contain the book we
// asked about is self-evidently wrong, and gets thrown away (see the position
// check in shape()). The client then advances by indexing an array it already
// holds, so finishing a volume needs no network at all.
//
// Three things here are load-bearing:
//
//   1. THE MODEL IS HAIKU, AND effort IS NOT SET. This is a lookup, not a
//      judgement — Haiku costs roughly a fifth of Opus and answers it fine.
//      recommend.js pins `effort: 'low'` because it runs on Opus 5, which
//      thinks by default; Haiku 4.5 does not think and REJECTS
//      output_config.effort with a 400. Adding it here to "match" recommend.js
//      would break every request.
//
//   2. EVERY VOLUME IS VERIFIED AGAINST OPEN LIBRARY. Structured output
//      guarantees the shape of the answer, not its truth. A volume the
//      catalogue can't confirm is kept in the list — positions have to stay
//      stable — but marked unverified, and the client will not advance onto
//      one. An invented sequel must never reach someone's shelf.
//
//   3. CACHING IS ASYMMETRIC. A verified answer is cached forever, because
//      series order is a globally stable fact and the first reader to add a
//      book should pay for every reader after them. Everything less certain
//      gets a TTL or no cache at all — see cachePolicy() below.
import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-haiku-4-5'

// Room for a long series and its titles, and nothing more. There is no thinking
// to leave space for.
const MAX_TOKENS = 2048

// Bumping this abandons the entire cache in one edit. That is the whole
// mitigation for the risk of a no-TTL cache: a wrong answer is permanent until
// someone changes this number, and then none of them are.
//
// v2 (2026-07-31): v1 answered "Heir of Fire" with Crescent City rather than
// Throne of Glass, and the answer named a real next volume which verified, so
// it was cached under the no-TTL policy and would have been permanent.
// v3 (2026-07-31): the shape changed from one-next-volume to the whole list.
// v4 (2026-08-10): "companion volumes do not belong in the list" was dropping
// Tower of Dawn from Throne of Glass — a main numbered entry that runs parallel
// to Empire of Storms and is widely described as a companion. The six-volume
// answer verified cleanly and so was cached forever, leaving the dropped book
// with no series at all and silently renumbering the one after it.
const CACHE_VERSION = 4

// A verified series with a verified volume list is a fact, and facts don't
// expire. Everything else does — see cachePolicy().
const SOFT_TTL_SECONDS = 60 * 60 * 24 * 30

// Discworld is 41 books. Past this we are not looking at a series any more, and
// each volume costs an Open Library request to verify.
const MAX_VOLUMES = 30

// No minItems/maxItems and no nullable types: the supported schema subset is
// small, so absence is spelled with sentinels — '' for a missing string, an
// empty array for a missing list — and normalised away in shape() below.
//
// Note there is no `position` field. The model is NOT asked where this book
// sits; the position is derived by finding the book in the list it returned.
// That removes a whole class of answer that disagrees with itself, and turns
// the derivation into a free correctness check.
export const SERIES_SCHEMA = {
  type: 'object',
  properties: {
    inSeries: { type: 'boolean' },
    seriesName: { type: 'string' },
    volumes: { type: 'array', items: { type: 'string' } }
  },
  required: ['inSeries', 'seriesName', 'volumes'],
  additionalProperties: false
}

const SYSTEM = `You answer one factual question about one book: is it part of a series, and if so, what are all the books in that series in order?

Rules:
- Only answer for series you are confident actually exist. A standalone book is the common case and the correct answer for most books.
- MANY AUTHORS WRITE SEVERAL SERIES. Answer about the series THIS EXACT TITLE belongs to — never the author's best known, most recent, or largest series. Sarah J. Maas, Brandon Sanderson, Terry Pratchett and Robin Hobb all have multiple; getting the author right and the series wrong is the most damaging mistake you can make here.
- "volumes" lists the titles of the main entries, in PUBLICATION ORDER, and MUST include the book you were asked about. If the book you were asked about does not belong in the list you are writing, you have the wrong series — answer inSeries false instead.
- Include every volume in the publisher's main numbered sequence — including one described as a "companion" novel, one that follows a different set of characters, or one that runs parallel to another book rather than after it. If it is numbered in the sequence, it belongs in the list. Leave out novellas, short stories, omnibus editions, boxed sets and anything published outside the numbering.
- Use publication order, not chronological or internal-timeline order. Prequels published later come later.
- List only volumes that have actually been published or have a confirmed title. Never invent a title to fill a gap or to round the series out.
- If you cannot place this exact title in a specific series with confidence, answer inSeries false with an empty list. Saying nothing is always better than naming the wrong series.`

const userPrompt = ({ title, author }) =>
  author ? `Title: ${title}\nAuthor: ${author}` : `Title: ${title}`

// ── Identity ────────────────────────────────────────────────────────────────

// Must match slug() in js/services/book-shape.js. The client's free fallback
// parser derives seriesKey from an Open Library subject tag with the same
// function, so a book enriched here and a book parsed there have to land on the
// same key or the shelf would render one series as two.
// Exported for tests/contract.test.mjs, which pins this against the client's
// copy in js/services/book-shape.js. Drift here splits one series into two.
export function slug(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Exported for tests/worker.test.mjs, so the fan-out's keys can be checked
// against the key a later request will actually compute rather than a literal
// string that a CACHE_VERSION bump would falsify.
export const cacheKey = (title, author) =>
  `series:v${CACHE_VERSION}:${slug(title)}:${slug(author || '')}`

// ── Verification ────────────────────────────────────────────────────────────

const OPEN_LIBRARY = 'https://openlibrary.org/search.json'
const OL_FIELDS = 'key,title,author_name,first_publish_year,cover_i'
const OL_TIMEOUT_MS = 6000

// "&" spelled out and punctuation dropped. Open Library files Susanna Clarke's
// second novel as "Jonathan Strange & Mr. Norrell" while a model writes "Mr
// Norrell", and an exact match would drop that as an invention — the
// anti-hallucination guard failing in the direction nobody notices. The same
// function decides whether the queried book appears in the returned list, so
// "Heir of Fire" matching "Heir of Fire (Throne of Glass #3)" is deliberate.
export function norm(s){
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function sameTitle(a, b){
  const x = norm(a), y = norm(b)
  if(!x || !y) return false
  return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ')
}

// One volume, checked against the catalogue. Resolves to the real record when
// Open Library knows it and to null when it doesn't — and THROWS when the
// check couldn't be made at all. The caller has to tell those apart: caching
// "this book doesn't exist" after a network blip would make the blip permanent.
async function verifyVolume(title, author){
  const q = [title, author].filter(Boolean).join(' ')
  const url = `${OPEN_LIBRARY}?q=${encodeURIComponent(q)}&limit=5&fields=${OL_FIELDS}`
  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), OL_TIMEOUT_MS)
  try{
    const res = await fetch(url, { signal: timer.signal, headers: { Accept: 'application/json' } })
    if(!res.ok) throw new Error(`open library: ${res.status}`)
    const data = await res.json()
    const docs = Array.isArray(data && data.docs) ? data.docs : []
    const match = docs.find(d => d && sameTitle(d.title, title))
    if(!match) return null

    // The catalogue's record wins on everything, so a volume that lands on the
    // shelf is a real book with a real cover rather than a title the model
    // typed. Absent fields are omitted, never null — see book-shape.js.
    const out = { title: String(match.title).trim(), verified: true }
    const names = Array.isArray(match.author_name) ? match.author_name.filter(Boolean) : []
    const name = names.slice(0, 2).join(' & ')
    if(name) out.author = name
    if(match.key) out.workKey = String(match.key)
    if(Number.isFinite(match.cover_i)) out.coverId = match.cover_i
    if(Number.isFinite(match.first_publish_year)) out.year = match.first_publish_year
    return out
  } finally {
    clearTimeout(stop)
  }
}

// ── Shaping ─────────────────────────────────────────────────────────────────

// The model's answer, normalised — or null, meaning "treat this as a
// standalone".
//
// The position check is the important line. The model was asked for a list that
// includes the book we asked about; a list that doesn't contain it is
// self-evidently about some other series, and the whole answer is thrown away.
// That is what catches "Heir of Fire → Crescent City" without needing to know
// anything about either series.
export function shape(parsed, title){
  if(!parsed || parsed.inSeries !== true) return null
  const name = String(parsed.seriesName || '').trim()
  if(!name) return null

  const titles = (Array.isArray(parsed.volumes) ? parsed.volumes : [])
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .slice(0, MAX_VOLUMES)
  // A "series" of one is a standalone with extra steps.
  if(titles.length < 2) return null

  const index = titles.findIndex(t => sameTitle(t, title))
  if(index === -1) return null

  const key = slug(name)
  if(!key) return null
  return { key, name, position: index + 1, total: titles.length, titles }
}

// One answer, cached for every volume it names.
//
// The cache key is per TITLE, so seven books in one series meant seven Haiku
// calls and seven independent chances to be wrong — the per-book retry that
// asking for the whole series was supposed to remove. It removed the CHAIN, not
// the retry: a reader who added all seven Throne of Glass books paid for seven
// lookups, and three of them came back with nothing.
//
// But a verified list already answers for every title in it. The list is the
// same list; only the position differs, and the position is the index. So one
// call fills the cache for the whole series and the sixth book someone adds
// never reaches the model at all.
//
// Two limits, both deliberate:
//
//   1. ONLY VERIFIED VOLUMES GET AN ENTRY. An unverified title is one the
//      catalogue could not confirm, and writing a permanent entry asserting it
//      is a real book in a real series is the invention this file refuses
//      everywhere else. It stays in the list — positions must be stable — and
//      is simply not cached under its own name.
//   2. ENTRIES ARE KEYED BY THE VOLUME'S CATALOGUE AUTHOR, which is what a
//      client that found the book through search will send back. A book typed
//      by hand with no author misses and pays for a lookup, exactly as today.
export function fanOut(series, queried){
  const out = []
  series.volumes.forEach((volume, i) => {
    if(!volume || !volume.verified) return
    const key = cacheKey(volume.title, volume.author || queried.author)
    // The caller writes the queried key itself, under the title as it was
    // ASKED, which the catalogue may spell differently.
    if(key === queried.key) return
    out.push({ key, series: { ...series, position: i + 1 } })
  })
  return out
}

// What to do with an answer once we have it.
//
//   'forever'  a self-consistent series whose volumes we were able to check —
//              a stable fact
//   'soft'     a standalone. True today and possibly not next year, since an
//              author may yet write a sequel, so a 30-day TTL lets a wrong
//              "no series" heal itself.
//   'never'    Open Library couldn't be reached for at least one volume.
//              Caching this would turn one bad minute into a permanently
//              truncated series for every reader.
function cachePolicy(series, checkFailed){
  if(checkFailed) return 'never'
  return series ? 'forever' : 'soft'
}

// ── The route ───────────────────────────────────────────────────────────────

// Returns { series } — either null, or
// { key, name, position, total, volumes: [{ title, verified, … }] }.
// Throws on any upstream failure; the caller turns that into a typed error.
export async function lookupSeries(env, { title, author }){
  // A dedicated SERIES namespace if one is bound, and the quota namespace
  // otherwise. Falling back means this route works the moment it deploys, with
  // no namespace to create first; the keys can't collide (`series:` here,
  // `q:`/`s:` there), and moving to a namespace of its own later is a
  // wrangler.toml edit and nothing else.
  const kv = env.SERIES || env.QUOTA || null
  const key = cacheKey(title, author)

  if(kv){
    // A cache read must never be able to take the route down: a KV outage
    // should cost a Haiku call, not an error.
    try{
      const hit = await kv.get(key, 'json')
      if(hit) return { series: hit.series ?? null, cached: true }
    }catch(e){ /* fall through and ask */ }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SERIES_SCHEMA } },
    messages: [{ role: 'user', content: userPrompt({ title, author }) }]
  })

  if(message.stop_reason === 'refusal') throw new Error('refusal')
  const text = (message.content || []).find(b => b.type === 'text')
  if(!text) throw new Error(`no content (stop_reason: ${message.stop_reason})`)

  const parsed = JSON.parse(text.text)
  const found = shape(parsed, title)

  let series = null
  let checkFailed = false
  if(found){
    // All volumes at once. This is the expensive half of the call — up to
    // MAX_VOLUMES Open Library requests — and it happens exactly once per
    // series across every reader, which is what the no-TTL cache buys.
    const checked = await Promise.allSettled(
      found.titles.map(t => verifyVolume(t, author))
    )
    checkFailed = checked.some(r => r.status === 'rejected')
    // Unverified volumes stay in the list: positions have to be stable, and a
    // book Open Library simply hasn't catalogued yet is not the same thing as
    // an invention. The client refuses to advance onto one either way.
    const volumes = found.titles.map((t, i) => {
      const r = checked[i]
      return (r.status === 'fulfilled' && r.value) ? r.value : { title: t, verified: false }
    })
    series = {
      key: found.key,
      name: found.name,
      position: found.position,
      total: found.total,
      volumes
    }
  }

  const policy = cachePolicy(series, checkFailed)
  if(kv && policy !== 'never'){
    const opts = policy === 'soft' ? { expirationTtl: SOFT_TTL_SECONDS } : undefined
    // Only a 'forever' answer is worth spreading. A 'soft' one is a standalone,
    // which names no other volumes to spread it to.
    const writes = [{ key, series }]
    if(policy === 'forever') writes.push(...fanOut(series, { key, author }))
    // Best-effort, like the quota refund: failing to cache an answer we already
    // have is not worth failing the response over. allSettled, so one rejected
    // write cannot lose the others.
    await Promise.allSettled(writes.map(w =>
      kv.put(w.key, JSON.stringify({ series: w.series }), opts)))
  }

  return { series, cached: false }
}
