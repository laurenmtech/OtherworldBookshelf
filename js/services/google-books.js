// Google Books: the secondary source, and the one that knows about books
// published this month.
//
//   GET https://www.googleapis.com/books/v1/volumes?q=…&key=…
//     → { items: [ { id, volumeInfo: { title, authors[], publishedDate,
//                    categories[], imageLinks: { thumbnail } } } ] }
//
// It needs a key. Keyless requests share ONE global anonymous quota pool across
// everyone on the internet who calls without one, and that pool is routinely
// exhausted — every keyless call tested returned 429 citing Google's own shared
// consumer project. So without a key this source is simply off, and Open
// Library answers alone.
//
// The key is public by design, exactly like firebase-config.js: read-only,
// restricted to this site by HTTP referrer, and capped at a daily quota. See
// search-config.js.
import { authorsToString, genresFrom } from './book-shape.js'

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes'

export function apiKey(){
  return (typeof window !== 'undefined' && window.GOOGLE_BOOKS_KEY) || ''
}

export function isEnabled(){ return !!apiKey() }

// "2026-07-07", "2026-07", "2026" — only the year is worth keeping, and a
// missing or unparseable date must leave no key behind at all.
function yearOf(published){
  const m = /^(\d{4})/.exec(String(published || ''))
  return m ? Number(m[1]) : null
}

// Thumbnails come back on http with a page-curl effect baked in. Both are
// fixable in the URL, and both matter: http would be blocked as mixed content
// on a site served over https, and the curl is a 2009 skeuomorph.
function coverFrom(links){
  const raw = links && (links.thumbnail || links.smallThumbnail)
  if(!raw) return null
  return String(raw).replace(/^http:/, 'https:').replace(/&edge=curl/g, '')
}

export function normalise(item){
  const v = (item && item.volumeInfo) || {}
  const title = String(v.title || '').trim()
  if(!title) return null
  const book = { title, author: authorsToString(v.authors), source: 'google-books' }
  // Deliberately NOT workKey: a Google volume id is a different namespace, and
  // claiming one would stop this book ever being recognised as the same book
  // when Open Library catches up and offers it with a real work key.
  if(item.id) book.googleId = String(item.id)
  const cover = coverFrom(v.imageLinks)
  if(cover) book.coverSrc = cover
  const year = yearOf(v.publishedDate)
  if(year) book.year = year
  // BISAC paths — "Fiction / Fantasy / Epic" — through the same vocabulary the
  // Open Library subjects go through.
  const genres = genresFrom(v.categories)
  if(genres.length) book.genres = genres
  return book
}

// Returns [{ book, weight }]. Weight is 0: Google exposes no edition count, and
// leaving it at zero means an Open Library record wins a tie, which is what we
// want — it carries the stable work id.
//
// Never throws for a reason the app should shrug at (no key, quota, offline).
// A dead secondary source must not take the search down with it.
export async function search(query, { signal, limit }){
  const key = apiKey()
  if(!key) return []
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}` +
              `&maxResults=${Math.min(limit, 40)}&printType=books&key=${encodeURIComponent(key)}`
  try{
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
    if(!res.ok) return []          // 429 quota, 403 bad referrer — not our problem to shout about
    const data = await res.json()
    const items = Array.isArray(data && data.items) ? data.items : []
    return items.map(i => ({ book: normalise(i), weight: 0 })).filter(x => x.book)
  }catch(err){
    if(err && err.name === 'AbortError') throw err   // supersession still has to work
    return []
  }
}
