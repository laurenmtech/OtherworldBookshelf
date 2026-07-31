// Open Library: the primary source. No key, permissive CORS, stable work ids.
//
// `series` is NOT requested: the field is accepted and comes back absent for every
// doc. The `series:` entries inside `subject` are the real source, and they are
// sparse enough that services/series.js exists.
import { authorsToString, genresFrom, parseSeries } from './book-shape.js'

const ENDPOINT = 'https://openlibrary.org/search.json'

const FIELDS = 'key,title,author_name,first_publish_year,cover_i,edition_count,subject'

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
