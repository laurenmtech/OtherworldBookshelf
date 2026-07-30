// Open Library: the primary source. No key, no registration, permissive CORS,
// and one request returns title, author, year, cover and a stable work id.
//
//   GET https://openlibrary.org/search.json?q=…&limit=…&fields=…
//     → { docs: [ { key: "/works/OL20893680W", title: "Piranesi",
//                   author_name: ["Susanna Clarke"], first_publish_year: 2020,
//                   cover_i: 10226290, edition_count: 24, subject: [...] } ] }
//
// Its weakness is recency: it carries some 2026 titles but lags the newest
// releases by months — Adrian Tchaikovsky's Green City Wars and Daphne
// Woolsoncroft's The Season of Sinking were both absent weeks after
// publication, while their back catalogues were present. That gap is why
// google-books.js exists.
import { authorsToString, genresFrom, parseSeries } from './book-shape.js'

const ENDPOINT = 'https://openlibrary.org/search.json'

// `subject` is the expensive one — it takes a six-result response from ~3KB to
// ~8KB — and it earns that, because it is the only place genre AND series can
// be read without a second request per book.
//
// `series` is NOT requested: the field is accepted and comes back absent for
// every doc, including Stormlight, Mistborn, Wheel of Time, Harry Potter and
// Dune. The `series:` entries inside `subject` are the real source.
const FIELDS = 'key,title,author_name,first_publish_year,cover_i,edition_count,subject'

// Series arrives as a tagged subject: "series:The Wheel of Time". A book can
// carry more than one — The Final Empire is tagged both "The Mistborn Saga" and
// "Mistborn Original Trilogy" — and the first is the one Open Library lists
// first, which is as good a tiebreak as exists here.
function seriesFrom(subjects){
  for(const s of subjects){
    const text = String(s || '')
    if(/^series:/i.test(text)){
      const parsed = parseSeries(text.slice(7))
      if(parsed) return parsed
    }
  }
  return null
}

export function normalise(doc){
  const title = String((doc && doc.title) || '').trim()
  if(!title) return null
  const book = { title, author: authorsToString(doc.author_name), source: 'openlibrary' }
  if(doc.key) book.workKey = String(doc.key)
  if(Number.isFinite(doc.cover_i)) book.coverId = doc.cover_i
  if(Number.isFinite(doc.first_publish_year)) book.year = doc.first_publish_year
  const subjects = Array.isArray(doc.subject) ? doc.subject : []
  const series = seriesFrom(subjects)
  if(series) Object.assign(book, series)
  const genres = genresFrom(subjects)
  if(genres.length) book.genres = genres
  return book
}

// Returns [{ book, weight }] — weight is edition_count, which the merged
// ranking uses only to separate results that matched the query equally well.
export async function search(query, { signal, limit }){
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if(!res.ok) throw new Error(`open library: ${res.status}`)
  const data = await res.json()
  const docs = Array.isArray(data && data.docs) ? data.docs : []
  return docs
    .map(d => ({ book: normalise(d), weight: d.edition_count || 0 }))
    .filter(x => x.book)
}
