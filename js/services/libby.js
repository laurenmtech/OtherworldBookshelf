// Libraries, Libby, and where else a book might come from.
//
// Two very different things, and the difference is the design: the DEEP LINKS are
// ordinary URLs and are the product; the thunder.api.overdrive.com CATALOGUE API
// is undocumented and unsupported, so everything touching it sits behind
// AVAILABILITY, fails silently, and leaves no gap on screen.
//
// You cannot search Libby for a library — verified against nine parameter names.
// You give the key and it gives the name back to confirm.
const THUNDER = 'https://thunder.api.overdrive.com/v2/libraries'
const TIMEOUT_MS = 6000

export const AVAILABILITY = true

export function libbySearchUrl(libraryKey, title){
  if(!libraryKey || !title) return null
  return `https://libbyapp.com/search/${encodeURIComponent(libraryKey)}` +
         `/search/query-${encodeURIComponent(title)}/page-1`
}

export function libbyTitleUrl(id){
  return id ? `https://share.libbyapp.com/title/${encodeURIComponent(id)}` : null
}

export function bookshopUrl(title, author){
  const q = [title, author].filter(Boolean).join(' ')
  if(!q) return null
  return `https://bookshop.org/search?keywords=${encodeURIComponent(q)}`
}

const SEARCH_KEYS = ['q', 'query', 'keyword', 'keywords', 'search', 'searchterm', 's', 'term', 'k']

export function learnSearchUrl(pasted){
  const text = String(pasted || '').trim()
  if(!text) return null
  let u
  try{ u = new URL(text) }catch(e){ return null }
  if(!/^https?:$/.test(u.protocol)) return null

  for(const key of SEARCH_KEYS){
    for(const [name, value] of u.searchParams){
      if(name.toLowerCase() !== key || !value) continue
      const copy = new URL(u)
      copy.searchParams.set(name, '%s')
      return copy.toString().replace(/%25s/g, '%s')
    }
  }

  const parts = u.pathname.split('/').filter(Boolean)
  if(parts.length >= 2 && /search|browse|catalog/i.test(parts[parts.length - 2])){
    parts[parts.length - 1] = '%s'
    u.pathname = '/' + parts.join('/')
    return u.toString().replace(/%25s/g, '%s')
  }
  return null
}

export function shopSearchUrl(shop, title, author){
  if(!shop) return null
  const q = [title, author].filter(Boolean).join(' ')
  if(shop.searchUrl && q) return shop.searchUrl.replace(/%s/g, encodeURIComponent(q))
  return shop.url || null
}

export function parseLibraryKey(input){
  const text = String(input || '').trim()
  if(!text) return ''
  const m = text.match(/libbyapp\.com\/(?:library|search)\/([A-Za-z0-9_-]+)/i)
  if(m) return m[1].toLowerCase()
  if(/^[A-Za-z0-9_-]+$/.test(text)) return text.toLowerCase()
  return ''
}

async function get(url, { signal } = {}){
  const timer = new AbortController()
  const stop = setTimeout(() => timer.abort(), TIMEOUT_MS)
  const forward = () => timer.abort()
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

export async function lookupLibrary(key, opts){
  const k = parseLibraryKey(key)
  if(!k) return null
  const d = await get(`${THUNDER}/${encodeURIComponent(k)}`, opts)
  if(!d || !d.name) return null
  return { key: d.preferredKey || k, name: d.name, websiteId: d.websiteId }
}

export async function availability(libraryKey, book, opts = {}){
  if(!AVAILABILITY) return null
  if(!libraryKey || !book || !book.title) return null
  const formats = opts.formats || ['ebook']
  if(!formats.length) return null
  const q = encodeURIComponent(book.title)
  const d = await get(`${THUNDER}/${encodeURIComponent(libraryKey)}/media?query=${q}`, opts)
  if(!d || !Array.isArray(d.items)) return null      // failure, not an answer

  const pool = d.items
    .filter(i => formats.includes(i && i.type && i.type.id))
    .filter(i => sameBook(i, book))
  if(!pool.length) return { status: 'none' }

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

const cache = new Map()
const inFlight = new Map()

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

const cacheKey = (libraryKey, book, formats) => {
  const identity = book.workKey
    ? String(book.workKey)
    : `${String(book.title || '')}|${String(book.author || '')}`
  return `${libraryKey}|${[...formats].sort().join('+')}|${identity.toLowerCase()}`
}

export function cachedAvailability(libraryKey, book, formats = ['ebook']){
  if(!libraryKey || !book || !formats.length) return undefined
  return cache.get(cacheKey(libraryKey, book, formats))
}

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
