// What a book IS, independent of who told us about it.
//
// Two sources answer searches now — Open Library and Google Books — and they
// describe books completely differently. This module is what they both have to
// produce, so the rest of the app never learns which one an entry came from.
//
// Absent fields are OMITTED, never null or ''. A book the search knew nothing
// about must be indistinguishable from a hand-typed one, so "no cover" is a
// missing key everywhere and never an empty frame to render.

// -M is 180px wide: sharp on the headline card at any density, and small
// enough that a shelf's worth costs less than one webfont.
export function coverUrl(coverId, size = 'M'){
  if(coverId == null || coverId === '') return null
  return `https://covers.openlibrary.org/b/id/${encodeURIComponent(coverId)}-${size}.jpg`
}

// Never prompted for, and never required: a format is only worth recording
// because three books at once are easier to tell apart when one of them is
// obviously the audiobook.
export const FORMATS = [
  { key: 'print', label: 'Print' },
  { key: 'ebook', label: 'Ebook' },
  { key: 'audio', label: 'Audio' }
]

// How one book is recognised as the same book twice: the Open Library work
// identifier when both sides have one, and title+author otherwise.
//
// Google Books results deliberately carry NO workKey — their volume ids are
// from a different namespace, and setting one would mean the same book added
// from Google and found later on Open Library never recognised each other.
// Falling through to title+author is what lets the two sources agree.
export function bookKey(book){
  if(!book) return ''
  if(book.workKey) return String(book.workKey)
  const title = String(book.title || '').trim().toLowerCase()
  const author = String(book.author || '').trim().toLowerCase()
  return `t:${title}|${author}`
}

// Where in the shelf a book already sits, or null. Current reads are checked
// before the pile so "you're reading this" wins over "it's on your list" for a
// book that is somehow on both.
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

// Two authors are a collaboration worth showing; a list of nine is a credits
// roll, so it stops there.
export function authorsToString(names){
  const list = Array.isArray(names) ? names.filter(Boolean) : []
  if(!list.length) return ''
  return list.slice(0, 2).join(' & ')
}

// "The Stormlight Archive #1", "Discworld, Book 12", "Wayfarers no. 3" — the
// position is a suffix on the name often enough to be worth pulling apart, and
// absent often enough that finding none must be normal rather than a failure.
const POSITION = /[,;]?\s*(?:#|no\.?\s*|bk\.?\s*|book\s+|vol\.?\s*|part\s+)(\d+(?:\.\d+)?)\s*$/i

function slug(s){
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

// ── Genre ───────────────────────────────────────────────────────────────────
// Neither source gives a usable genre directly. Open Library has a structured
// `genre:` tag on only a small minority of works and otherwise a subject list
// that mixes real subjects with "nyt:hardcover-fiction=2010-09-19",
// "Accessible book" and "Amerikanisches Englisch". Google Books gives BISAC
// paths like "Fiction / Fantasy / Epic".
//
// Both are strings, so both are matched onto the same small fixed vocabulary —
// the same way the vibes are a fixed vocabulary. A shelf wants a word you'd say
// out loud, not a catalogue heading.
//
// Order matters twice: the more specific pattern must be tested before the
// general one it contains, and this order breaks ties between equal vote counts.
const GENRES = [
  { label: 'Science fiction', re: /\bscience[ -]fiction\b|\bsci-?fi\b/ },
  { label: 'Fantasy',         re: /\bfantasy\b/ },
  { label: 'Horror',          re: /\bhorror\b/ },
  { label: 'Mystery',         re: /\bmystery\b|\bdetective\b|\bwhodunit\b/ },
  { label: 'Thriller',        re: /\bthriller|\bsuspense\b/ },
  { label: 'Romance',         re: /\bromance\b|\blove stories\b/ },
  // "Historical" is the label a novel wants; "History" is the one a history
  // book wants. They must not share a pattern — Pride and Prejudice is tagged
  // "Fiction, Romance, Historical, Regency" many times over and would otherwise
  // out-vote its way to being filed as History.
  { label: 'Historical',      re: /\bhistorical\b/ },
  { label: 'Young adult',     re: /\byoung adult\b|\bjuvenile fiction\b/ },
  { label: 'Poetry',          re: /\bpoetry\b|\bpoems\b/ },
  { label: 'Memoir',          re: /\bmemoir|\bautobiograph/ },
  { label: 'Biography',       re: /\bbiograph/ },
  { label: 'History',         re: /\bhistory\b/ },
  // The lookahead is load-bearing: without it every science fiction novel is
  // also tagged Science, because "hard science fiction" contains "science".
  { label: 'Science',         re: /\bscience\b(?![ -]fiction)|\bphysics\b|\bbiology\b|\bastronomy\b/ },
  { label: 'Psychology',      re: /\bpsycholog/ },
  { label: 'Self-help',       re: /\bself-?help\b|personal growth|\bhabit\b/ },
  { label: 'Business',        re: /\bbusiness\b|\beconomics\b|\bmanagement\b/ },
  { label: 'Philosophy',      re: /\bphilosoph/ },
  { label: 'Essays',          re: /\bessays\b/ }
]

// At most two. A third is where these stop being a label and start being a
// catalogue record.
const MAX_GENRES = 2

// Ranked by how many strings vote for each, because one stray "Fiction,
// fantasy, epic" should not outweigh four mentions of mystery.
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
