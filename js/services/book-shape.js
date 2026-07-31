// What a Book IS, independent of which source described it.
//
// Absent fields are OMITTED, never null or '' — a book the search knew nothing
// about must be indistinguishable from a hand-typed one.
//
// SERIES is the Phase 7 feature flag. It lives here, not beside the network code,
// because the store and both lists need it without importing anything that can
// make a request.
export function coverUrl(coverId, size = 'M'){
  if(coverId == null || coverId === '') return null
  return `https://covers.openlibrary.org/b/id/${encodeURIComponent(coverId)}-${size}.jpg`
}

export const FORMATS = [
  { key: 'print', label: 'Print' },
  { key: 'ebook', label: 'Ebook' },
  { key: 'audio', label: 'Audio' }
]

export function bookKey(book){
  if(!book) return ''
  if(book.workKey) return String(book.workKey)
  const title = String(book.title || '').trim().toLowerCase()
  const author = String(book.author || '').trim().toLowerCase()
  return `t:${title}|${author}`
}

export function findExisting(state, book){
  const key = bookKey(book)
  if(!key || key === 't:|') return null
  const lists = [
    { list: 'currentReads', route: '/', entries: state.currentReads },
    { list: 'wishlist', route: '/', entries: state.wishlist },
    { list: 'finished', route: '/finished', entries: state.finished }
  ]
  for(const { list, route, entries } of lists){
    const index = (entries || []).findIndex(b => bookKey(b) === key)
    if(index !== -1) return { list, route, index, entry: entries[index], key }
  }
  return null
}

export function authorsToString(names){
  const list = Array.isArray(names) ? names.filter(Boolean) : []
  if(!list.length) return ''
  return list.slice(0, 2).join(' & ')
}

export const SERIES = true

export function inSeries(book){
  return !!(SERIES && book && book.seriesKey && !book.seriesDetached)
}

export function sameSeries(a, b){
  return inSeries(a) && inSeries(b) && a.seriesKey === b.seriesKey
}

export function byVolume(a, b){
  const pa = Number.isFinite(a && a.seriesPosition) ? a.seriesPosition : Infinity
  const pb = Number.isFinite(b && b.seriesPosition) ? b.seriesPosition : Infinity
  if(pa !== pb) return pa - pb
  const ta = Date.parse(a && a.finishedAt)
  const tb = Date.parse(b && b.finishedAt)
  if(Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if(Number.isNaN(ta)) return 1
  if(Number.isNaN(tb)) return -1
  return ta - tb
}

const POSITION = /[,;]?\s*(?:#|no\.?\s*|bk\.?\s*|book\s+|vol\.?\s*|part\s+)(\d+(?:\.\d+)?)\s*$/i

export function slug(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function parseSeries(raw){
  const text = String(raw || '').trim()
  if(!text) return null
  const m = text.match(POSITION)
  const name = (m ? text.slice(0, m.index) : text).replace(/[,;\s]+$/, '').trim()
  if(!name) return null
  const out = { seriesKey: slug(name), seriesName: name }
  if(m) out.seriesPosition = Number(m[1])
  return out
}

const GENRES = [
  { label: 'Science fiction', re: /\bscience[ -]fiction\b|\bsci-?fi\b/ },
  { label: 'Fantasy',         re: /\bfantasy\b/ },
  { label: 'Horror',          re: /\bhorror\b/ },
  { label: 'Mystery',         re: /\bmystery\b|\bdetective\b|\bwhodunit\b/ },
  { label: 'Thriller',        re: /\bthriller|\bsuspense\b/ },
  { label: 'Romance',         re: /\bromance\b|\blove stories\b/ },
  { label: 'Historical',      re: /\bhistorical\b/ },
  { label: 'Young adult',     re: /\byoung adult\b|\bjuvenile fiction\b/ },
  { label: 'Poetry',          re: /\bpoetry\b|\bpoems\b/ },
  { label: 'Memoir',          re: /\bmemoir|\bautobiograph/ },
  { label: 'Biography',       re: /\bbiograph/ },
  { label: 'History',         re: /\bhistory\b/ },
  { label: 'Science',         re: /\bscience\b(?![ -]fiction)|\bphysics\b|\bbiology\b|\bastronomy\b/ },
  { label: 'Psychology',      re: /\bpsycholog/ },
  { label: 'Self-help',       re: /\bself-?help\b|personal growth|\bhabit\b/ },
  { label: 'Business',        re: /\bbusiness\b|\beconomics\b|\bmanagement\b/ },
  { label: 'Philosophy',      re: /\bphilosoph/ },
  { label: 'Essays',          re: /\bessays\b/ }
]

const MAX_GENRES = 2

export function genresFrom(strings){
  const list = Array.isArray(strings) ? strings : []
  const votes = GENRES.map((g, i) => {
    let n = 0
    for(const s of list) if(g.re.test(String(s || '').toLowerCase())) n++
    return { label: g.label, n, i }
  }).filter(v => v.n > 0)
  votes.sort((a, b) => (b.n - a.n) || (a.i - b.i))
  return votes.slice(0, MAX_GENRES).map(v => v.label)
}
