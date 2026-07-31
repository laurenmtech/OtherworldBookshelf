// Google Books: the secondary source. Needs a key, knows new releases. A failure
// here is absorbed — a dead secondary must never take the search down.
import { authorsToString, genresFrom } from './book-shape.js'

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes'

export function apiKey(){
  return (typeof window !== 'undefined' && window.GOOGLE_BOOKS_KEY) || ''
}

export function isEnabled(){ return !!apiKey() }

function yearOf(published){
  const m = /^(\d{4})/.exec(String(published || ''))
  return m ? Number(m[1]) : null
}

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
  if(item.id) book.googleId = String(item.id)
  const cover = coverFrom(v.imageLinks)
  if(cover) book.coverSrc = cover
  const year = yearOf(v.publishedDate)
  if(year) book.year = year
  const genres = genresFrom(v.categories)
  if(genres.length) book.genres = genres
  return book
}

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
