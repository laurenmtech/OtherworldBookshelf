// Libraries, Libby, and where else a book might come from.
//
// Two very different things live here, and the difference is the whole design:
//
//   1. DEEP LINKS — ordinary URLs. libbyapp.com/search/<key>/… and
//      share.libbyapp.com/title/<id>. Nothing can break these; they are string
//      concatenation and they will work for as long as Libby has a website.
//
//   2. THE API — thunder.api.overdrive.com, the catalogue service Libby's own
//      web app calls. It is undocumented and unsupported. It works today, it
//      permits browser origins today, and it could change shape or start
//      refusing us tomorrow with nobody to tell.
//
// So the links are the product and the API is an enhancement. Everything that
// touches the API is behind AVAILABILITY, fails silently, and its absence must
// leave no gap on screen — see the borrow row in tbr-pile.js.
//
// Verified live before this was written: `access-control-allow-origin: *` on
// both endpoints used here, and real data back from both.

const THUNDER = 'https://thunder.api.overdrive.com/v2/libraries'
const TIMEOUT_MS = 6000

// The single flag the plan asked for from day one. Turn this off and every
// availability lookup stops; the deep links, the library names and the borrow
// prompts all carry on exactly as they are.
export const AVAILABILITY = true

// ── Deep links ──────────────────────────────────────────────────────────────

// Libby's search route. The odd `query-…/page-1` shape is Libby's own.
export function libbySearchUrl(libraryKey, title){
  if(!libraryKey || !title) return null
  return `https://libbyapp.com/search/${encodeURIComponent(libraryKey)}` +
         `/search/query-${encodeURIComponent(title)}/page-1`
}

// A specific title, by OverDrive id — what an availability result gives us.
export function libbyTitleUrl(id){
  return id ? `https://share.libbyapp.com/title/${encodeURIComponent(id)}` : null
}

// Where a library's own catalogue lives, for the entry that isn't on Libby.
export function libbyLibraryUrl(libraryKey){
  return libraryKey ? `https://libbyapp.com/library/${encodeURIComponent(libraryKey)}` : null
}

// Bookshop.org, not Amazon. Buying a book should be able to send money to a
// shop rather than to the company trying to replace them all. Used only when
// you haven't saved a shop of your own — yours beats a default.
export function bookshopUrl(title, author){
  const q = [title, author].filter(Boolean).join(' ')
  if(!q) return null
  return `https://bookshop.org/search?keywords=${encodeURIComponent(q)}`
}

// ── Learning a shop's search URL ────────────────────────────────────────────
// There is no common pattern. Harvard Book Store searches at `/search/?q=`,
// Powell's at `/searchresults?keyword=`, Bookshop.org at `/search?keywords=`.
// Nothing can be guessed, so the shop teaches us: search for anything on their
// site, paste the results URL, and we find the search term in it and remember
// the shape. Same idea as pasting a Libby link.
const SEARCH_KEYS = ['q', 'query', 'keyword', 'keywords', 'search', 'searchterm', 's', 'term', 'k']

// Returns a template with %s where the search term goes, or null if the URL
// doesn't look like a search at all.
export function learnSearchUrl(pasted){
  const text = String(pasted || '').trim()
  if(!text) return null
  let u
  try{ u = new URL(text) }catch(e){ return null }
  if(!/^https?:$/.test(u.protocol)) return null

  // A query parameter is how nearly every shop does it.
  for(const key of SEARCH_KEYS){
    for(const [name, value] of u.searchParams){
      if(name.toLowerCase() !== key || !value) continue
      const copy = new URL(u)
      copy.searchParams.set(name, '%s')
      // searchParams encodes the placeholder; put it back so it's readable and
      // so we can substitute without double-encoding.
      return copy.toString().replace(/%25s/g, '%s')
    }
  }

  // Some shops put the term in the path: /search/piranesi
  const parts = u.pathname.split('/').filter(Boolean)
  if(parts.length >= 2 && /search|browse|catalog/i.test(parts[parts.length - 2])){
    parts[parts.length - 1] = '%s'
    u.pathname = '/' + parts.join('/')
    return u.toString().replace(/%25s/g, '%s')
  }
  return null
}

// Fill a learned template with a book. Falls back to the shop's plain URL when
// there's no template — their front page is still more useful than a default
// shop, it just costs you one more search.
export function shopSearchUrl(shop, title, author){
  if(!shop) return null
  const q = [title, author].filter(Boolean).join(' ')
  if(shop.searchUrl && q) return shop.searchUrl.replace(/%s/g, encodeURIComponent(q))
  return shop.url || null
}

// A pasted Libby URL is the most reliable way someone can tell us their
// library, because it's the one they already have in front of them:
//   https://libbyapp.com/library/kcls        → kcls
//   https://libbyapp.com/search/kcls/…       → kcls
// Anything that isn't a URL is treated as the key itself, typed directly.
export function parseLibraryKey(input){
  const text = String(input || '').trim()
  if(!text) return ''
  const m = text.match(/libbyapp\.com\/(?:library|search)\/([A-Za-z0-9_-]+)/i)
  if(m) return m[1].toLowerCase()
  // Not a URL — a bare key. Keys are lowercase alphanumeric with dashes.
  if(/^[A-Za-z0-9_-]+$/.test(text)) return text.toLowerCase()
  return ''
}

// ── The API ─────────────────────────────────────────────────────────────────

async function get(url, { signal } = {}){
  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  const forward = () => timer.abort()
  // Checked before listening: addEventListener on an ALREADY-aborted signal
  // never fires, so a caller who gave up before we got here would otherwise be
  // ignored and the request would run to completion regardless.
  if(signal){
    if(signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  try{
    const res = await fetch(url, { signal: timer.signal, headers: { Accept: 'application/json' } })
    if(!res.ok) return null
    return await res.json()
  }catch(err){
    if(err && err.name === 'AbortError') throw err
    return null
  }finally{
    clearTimeout(stop)
    if(signal) signal.removeEventListener('abort', forward)
  }
}

// Confirm a library key is real, and get its official name back.
//
// This is how adding a library works, because searching for one is NOT
// possible: `/v2/libraries?query=seattle` ignores the query and returns all
// 13,050 libraries. Verified against query, search, q, name, libraryName,
// keyword, nameQuery, lat/long and postalCode — every one returns the same
// unfiltered list, and there is no /libraries/search endpoint. So the reader
// tells us the key and we tell them the name, which also makes a wrong guess
// visible: "austin" is Austin ISD, not Austin Public Library.
//
// Returns { key, name, websiteId } or null. Never throws except on abort.
export async function lookupLibrary(key, opts){
  const k = parseLibraryKey(key)
  if(!k) return null
  const d = await get(`${THUNDER}/${encodeURIComponent(k)}`, opts)
  if(!d || !d.name) return null
  return { key: d.preferredKey || k, name: d.name, websiteId: d.websiteId }
}

// What the library has, for one book.
//
// Matching is by title text — the API returns nothing for an ISBN query, so
// the plan's ISBN mitigation isn't available. The matched title comes back
// with the result so a wrong edition is visible on screen rather than silent,
// and "not found" is reported the same neutral way as "not owned": we are in
// no position to assert what a library does not have.
//
// Returns:
//   null                       — no usable answer. The endpoint failed, timed
//                                out, or is switched off. Render NOTHING; we
//                                know nothing and must not imply otherwise.
//   { status: 'none' }         — the library answered and had no match. Shown
//                                neutrally: "not found" and "not owned" are
//                                indistinguishable here, and neither justifies
//                                telling someone their library lacks a book.
//   { status, copies[] }       — 'available' or 'wait', best copy first.
export async function availability(libraryKey, book, opts = {}){
  if(!AVAILABILITY) return null
  if(!libraryKey || !book || !book.title) return null
  // Formats you'd actually borrow. An "available now" you'd never take is
  // worse than no answer at all — it's the app telling you about a copy that
  // isn't for you, and burying the one that is behind it.
  const formats = opts.formats || ['ebook']
  if(!formats.length) return null
  const q = encodeURIComponent(book.title)
  const d = await get(`${THUNDER}/${encodeURIComponent(libraryKey)}/media?query=${q}`, opts)
  if(!d || !Array.isArray(d.items)) return null      // failure, not an answer

  const pool = d.items
    .filter(i => formats.includes(i && i.type && i.type.id))
    .filter(i => sameBook(i, book))
  if(!pool.length) return { status: 'none' }

  // Available now beats a short wait beats a long one.
  pool.sort((a, b) =>
    (Number(b.isAvailable) - Number(a.isAvailable)) ||
    ((a.estimatedWaitDays ?? 1e9) - (b.estimatedWaitDays ?? 1e9)))

  const copies = pool.slice(0, 2).map(i => ({
    id: i.id,
    title: i.title,
    format: i.type.id,
    isAvailable: !!i.isAvailable,
    availableCopies: i.availableCopies || 0,
    ownedCopies: i.ownedCopies || 0,
    holds: i.holdsCount || 0,
    waitDays: Number.isFinite(i.estimatedWaitDays) ? i.estimatedWaitDays : null
  }))
  return { status: copies[0].isAvailable ? 'available' : 'wait', copies }
}

// ── Session cache ───────────────────────────────────────────────────────────
// One answer per book per library, held for as long as the tab lives. Scrolling
// a pile of thirty books must not re-ask thirty times, and an undocumented API
// we are guests on deserves the restraint.
//
// Not persisted, deliberately: availability is true for minutes, not days, and
// a cached "available now" that turns out to be a fortnight old is worse than
// no answer at all.
const cache = new Map()
const inFlight = new Map()

// At most this many lookups at once. A pile of forty books should not open
// forty sockets to someone else's service.
const MAX_PARALLEL = 3
let running = 0
const queue = []

function pump(){
  while(running < MAX_PARALLEL && queue.length){
    const job = queue.shift()
    running++
    job().finally(() => { running--; pump() })
  }
}

// The formats are part of the key, not just the query: change what you borrow
// and the old answers are answers to a different question. Keying them in
// means switching back finds the previous results still there.
//
// The author is in the key too, for books typed by hand — those have no
// workKey, so title alone would file two different books under one entry and
// hand the second one the first one's availability. sameBook() below checks
// the author, so only the cache was ever wrong, and only silently.
const cacheKey = (libraryKey, book, formats) => {
  const identity = book.workKey
    ? String(book.workKey)
    : `${String(book.title || '')}|${String(book.author || '')}`
  return `${libraryKey}|${[...formats].sort().join('+')}|${identity.toLowerCase()}`
}

// What we already know, without asking: undefined = never asked.
export function cachedAvailability(libraryKey, book, formats = ['ebook']){
  if(!libraryKey || !book || !formats.length) return undefined
  return cache.get(cacheKey(libraryKey, book, formats))
}

// Ask, once. Repeat calls for the same book return the same promise, and the
// answer is remembered — including a null, so a failing endpoint is asked once
// per book and then left alone.
export function requestAvailability(libraryKey, book, formats = ['ebook']){
  if(!AVAILABILITY || !libraryKey || !book || !book.title) return Promise.resolve(null)
  if(!formats.length) return Promise.resolve(null)
  const key = cacheKey(libraryKey, book, formats)
  if(cache.has(key)) return Promise.resolve(cache.get(key))
  if(inFlight.has(key)) return inFlight.get(key)

  const p = new Promise((resolve) => {
    queue.push(() => availability(libraryKey, book, { formats })
      .catch(() => null)
      .then((result) => { cache.set(key, result); resolve(result) }))
    pump()
  }).finally(() => inFlight.delete(key))

  inFlight.set(key, p)
  return p
}

// Test seam, and what a "check again" control would call.
export function clearAvailabilityCache(){ cache.clear(); inFlight.clear() }

// Title text has to agree, loosely — punctuation and case removed, and a
// subtitle on one side but not the other is still the same book. The author is
// checked only when both sides have one, since OverDrive's author field is
// inconsistent and a mismatch there is weaker evidence than a title match.
function norm(s){
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function sameBook(item, book){
  const a = norm(item.title)
  const b = norm(book.title)
  if(!a || !b) return false
  if(a !== b && !a.startsWith(b + ' ') && !b.startsWith(a + ' ')) return false
  const ia = norm((item.firstCreatorName || '').split(',').reverse().join(' '))
  const ib = norm(book.author)
  if(!ia || !ib) return true
  const words = ib.split(' ').filter(w => w.length > 2)
  return words.some(w => ia.includes(w))
}
