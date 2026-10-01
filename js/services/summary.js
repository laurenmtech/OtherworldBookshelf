// "What's this one about?" — the publisher's description, fetched when asked and
// never stored. It's long, it's the same for everyone, and keeping it on the
// shelf would ride along in every sync for a sentence you read once.
//
// Open Library first (the work's own description), Google Books second. Both
// write in their own markup; clean() turns either into plain paragraphs.
import { bookKey } from './book-shape.js'
import { apiKey } from './google-books.js'

const OL = 'https://openlibrary.org'
const GB = 'https://www.googleapis.com/books/v1/volumes'

export function clean(raw){
  let text = typeof raw === 'string' ? raw : String((raw && raw.value) || '')
  text = text
    .replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '’')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\r/g, '')
  // Open Library appends "----------\nAlso contained in:" lists and source footers.
  text = text.split(/\n\s*-{3,}/)[0]
  text = text
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')          // [1]: https://…
    .replace(/\(\s*\[source\]\[\d+\]\s*\)/gi, '')         // ([source][1])
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')             // [text][1]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // [text](url)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

async function json(url, signal){
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if(!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

async function fromOpenLibrary(book, signal){
  let key = book.workKey
  if(!key){
    const q = `title=${encodeURIComponent(book.title)}` +
              (book.author ? `&author=${encodeURIComponent(book.author)}` : '')
    const data = await json(`${OL}/search.json?${q}&limit=1&fields=key`, signal)
    key = data && data.docs && data.docs[0] && data.docs[0].key
  }
  if(!key) return ''
  const work = await json(`${OL}${key}.json`, signal)
  return clean(work && work.description)
}

async function fromGoogle(book, signal){
  const k = apiKey()
  if(!k) return ''
  if(book.googleId){
    const item = await json(`${GB}/${encodeURIComponent(book.googleId)}?key=${encodeURIComponent(k)}`, signal)
    const text = clean(item && item.volumeInfo && item.volumeInfo.description)
    if(text) return text
  }
  const q = `intitle:${book.title}` + (book.author ? ` inauthor:${book.author}` : '')
  const data = await json(`${GB}?q=${encodeURIComponent(q)}&maxResults=3&printType=books&key=${encodeURIComponent(k)}`, signal)
  for(const item of (data && data.items) || []){
    const text = clean(item.volumeInfo && item.volumeInfo.description)
    if(text) return text
  }
  return ''
}

const cache = new Map()

// Resolves to the text, or '' when neither source has one. Never rejects.
export function fetchSummary(book){
  const key = bookKey(book)
  if(cache.has(key)) return cache.get(key)
  const p = (async () => {
    for(const source of [fromOpenLibrary, fromGoogle]){
      try{
        const text = await source(book)
        if(text) return text
      }catch(_){ /* try the next one */ }
    }
    return ''
  })()
  cache.set(key, p)
  // A failed lookup isn't remembered: offline now may be online in a minute.
  p.then(text => { if(!text) cache.delete(key) })
  return p
}
