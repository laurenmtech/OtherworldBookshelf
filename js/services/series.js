// Series travel together.
//
// A series is one thing you are reading, not seven separate things. Finish a
// volume and the next one is already there — announced, not silently
// substituted — and the whole series occupies one slot on Current Reads however
// long it runs.
//
// ── Why the catalogue can't do this ─────────────────────────────────────────
// Seventeen fantasy series titles were queried against Open Library search on
// 2026-07-30. 6 of 17 carried a `series:` subject tag at all; 0 of 17 carried a
// position number. Worse than sparse, it is inconsistent WITHIN a series — The
// Way of Kings is tagged Stormlight Archive, Words of Radiance is not — and the
// names disagree with themselves ("The Mistborn Saga", "Red Rising Trilogy",
// "A_Court_of_Thorns_and_Roses"). Open Library cannot answer "is this in a
// series", "where in it", or "what comes next".
//
// So it is asked ONCE, at ADD time, for the WHOLE series — every volume in
// publication order, each checked against the catalogue — and the answer is
// cached on the book.
//
// ── Why the whole list, and not just the next volume ────────────────────────
// The first version asked "what comes after this book?" one book at a time.
// Getting from book 1 to book 7 then needed six consecutive correct answers,
// and one wrong answer anywhere ended the series three books in with nothing on
// screen to say why. It failed exactly that way on Throne of Glass: asked about
// Heir of Fire, the model answered "Crescent City" — Sarah J. Maas wrote both.
//
// Holding the list instead means nextVolume() is pure array indexing over data
// the book already carries. There is no chain to break, no per-volume guess,
// nothing to re-fetch when a volume is finished, and a wrong answer shows up
// immediately at book 1 rather than surfacing at book 3.
//
// ── Two rules this file exists to keep ──────────────────────────────────────
//
//   ADDING NEVER WAITS. enrich() is fired and forgotten. A book appears on the
//   shelf the moment it's picked, and the series fields arrive later or never.
//
//   FAILURE IS SILENCE. No series data, no answer, Worker down, offline, signed
//   out — the app behaves exactly as it did before this phase existed. A reader
//   who finishes a standalone must never see "couldn't find a next book".
import { idToken } from '../state/auth.js'
import { API_BASE } from './recommend.js'
import { bookKey, SERIES, inSeries } from './book-shape.js'
import { applySeries } from '../state/store.js'

export { SERIES } from './book-shape.js'

export const SERIES_URL = `${API_BASE}/series`

// Shorter than the recommender's 45s: this is a lookup nobody is waiting for,
// and a slow answer is worth abandoning rather than holding a request open.
const TIMEOUT_MS = 15000

// ── Asking ──────────────────────────────────────────────────────────────────

// The Worker's answer, as { answered, series }.
//
// The two halves are NOT interchangeable and must never be collapsed into a
// bare null, however tempting that looks:
//
//   { answered: true, series: null }   the Worker looked and said "standalone".
//                                      Authoritative — it replaces whatever the
//                                      free parser guessed off a subject tag.
//   { answered: false }                offline, signed out, Worker down, CORS,
//                                      timeout. We know NOTHING, and the book
//                                      must be left exactly as it is.
//
// Collapsing them means an unreachable Worker silently strips series data the
// catalogue had already supplied — which is the opposite of "with the Worker
// unreachable, everything behaves as it did before".
export async function lookup(book){
  if(!SERIES || !book || !book.title) return { answered: false }
  if(navigator.onLine === false) return { answered: false }

  let token = null
  try{ token = await idToken() }catch(e){ return { answered: false } }
  if(!token) return { answered: false }

  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  try{
    const res = await fetch(SERIES_URL, {
      method: 'POST',
      signal: timer.signal,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: book.title, author: book.author || '' })
    })
    if(!res.ok) return { answered: false }
    const data = await res.json()
    return { answered: true, series: fields(data && data.series) }
  }catch(err){
    return { answered: false }
  }finally{
    clearTimeout(stop)
  }
}

// { key, name, position, total, volumes } → the book fields. Absent values are
// omitted rather than nulled, exactly as everywhere else in the shape.
function fields(series){
  if(!series || !series.key || !series.name) return null
  const volumes = Array.isArray(series.volumes)
    ? series.volumes.filter(v => v && v.title)
    : []
  if(volumes.length < 2) return null
  const out = {
    seriesKey: String(series.key),
    seriesName: String(series.name),
    seriesVolumes: volumes
  }
  if(Number.isFinite(series.position) && series.position > 0) out.seriesPosition = series.position
  if(Number.isFinite(series.total) && series.total > 0) out.seriesTotal = series.total
  return out
}

// Fire and forget. Nothing awaits this and nothing surfaces if it fails.
//
// Called exactly where a book ENTERS the shelf, and nowhere else. Advancing to
// the next volume needs no lookup at all — it copies the list forward — which
// is the whole point of asking for the series rather than for one book.
//
// The store is patched by bookKey rather than by position, because by the time
// the answer lands the book may have moved, been finished, or been removed —
// and applySeries() simply finds nothing in that last case.
export function enrich(book){
  if(!SERIES || !book || !book.title) return
  const key = bookKey(book)
  if(!key) return
  lookup(book)
    .then(({ answered, series }) => { if(answered) applySeries(key, series) })
    .catch(() => {})
}

// ── What comes next ─────────────────────────────────────────────────────────
// Pure, synchronous, and local: everything it needs is already on the book.
// That is the whole point of asking for the list at add time.

const SERIES_FIELDS = ['seriesKey', 'seriesName', 'seriesPosition', 'seriesTotal', 'seriesVolumes']

function seriesOnly(book){
  const out = {}
  for(const f of SERIES_FIELDS) if(book[f] !== undefined) out[f] = book[f]
  return out
}

// The volume at 1-based `position`, as a book carrying the series with it.
// The list travels forward so the next advance is local too.
function volumeAt(from, position){
  const record = from.seriesVolumes[position - 1]
  const { verified, ...rest } = record
  return {
    ...rest,
    seriesKey: from.seriesKey,
    seriesName: from.seriesName,
    seriesPosition: position,
    seriesTotal: from.seriesTotal,
    seriesVolumes: from.seriesVolumes
  }
}

// A volume the catalogue says isn't out yet.
//
// Open Library's first_publish_year is the only signal we have, and it is
// occasionally wrong — but the consequence of believing it is mild (the book
// waits on the TBR pile instead of becoming your current read) and the
// consequence of ignoring it is not (you are handed a book you cannot read).
function forthcoming(volume){
  return Number.isFinite(volume.year) && volume.year > new Date().getFullYear()
}

// What finishing `book` should put in its place, or null for "nothing happens".
//
// Returns { book, fromWishlist, forthcoming } — fromWishlist is the pile index
// the volume was promoted from, or null if it's new; forthcoming means it isn't
// published yet, so it belongs on the pile rather than on Current Reads. Null
// overall is the common case and the safe one.
//
// The rules, all of which are non-negotiable:
//
//   A DETACHED SERIES ADVANCES NOTHING. inSeries() covers this, and covers the
//   feature flag in the same test.
//
//   A RE-READ RE-TRIGGERS NOTHING. Finishing a volume already in the record
//   advances nothing — you are re-reading, not progressing.
//
//   NOTHING IS ADDED THAT THE READER ALREADY HAS. A next volume already in the
//   record is skipped and the one after it offered; one already on the TBR pile
//   is promoted rather than duplicated.
//
//   AN UNVERIFIED VOLUME IS NEVER OFFERED. Open Library could not confirm it
//   exists, so the series stops there rather than handing over a title that
//   might be an invention.
//
// "Not for me" and "not right now" don't appear here because they don't call
// it: setDownCurrent() never advances, which is exactly the rule that being
// handed book 2 of something you just gave up on would break.
export function nextVolume(book, state){
  if(!inSeries(book)) return null
  if(!Array.isArray(book.seriesVolumes) || !book.seriesVolumes.length) return null
  if(!Number.isFinite(book.seriesPosition)) return null

  const read = new Map()
  for(const b of state.finished || []) read.set(bookKey(b), b)
  if(read.has(bookKey(book))) return null          // a re-read

  // Walk forward past anything already in the record — someone who read books
  // 3 to 7 out of order and is now finishing book 2 should be handed book 8.
  for(let position = book.seriesPosition + 1; position <= book.seriesVolumes.length; position++){
    const record = book.seriesVolumes[position - 1]
    if(!record) return null
    if(!record.verified) return null               // never invent

    const volume = volumeAt(book, position)
    const key = bookKey(volume)
    if(read.has(key)) continue                     // already read — try the one after

    const soon = forthcoming(record)
    const onPile = (state.wishlist || []).findIndex(b => bookKey(b) === key)
    if(onPile !== -1){
      // Promote what's already on the pile rather than adding a second copy,
      // keeping whatever that entry knows about itself and taking only the
      // series identity from the volume we computed. `fromWishlist` is the
      // entry this came from either way; finishCurrent() removes it when the
      // volume is being promoted and updates it in place when the volume is
      // forthcoming and staying put.
      return {
        book: { ...state.wishlist[onPile], ...seriesOnly(volume) },
        fromWishlist: onPile,
        forthcoming: soon
      }
    }
    return { book: volume, fromWishlist: null, forthcoming: soon }
  }
  return null                                       // end of the series
}
