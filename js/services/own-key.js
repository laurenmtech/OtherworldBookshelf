// A reader's own Anthropic key.
//
// This file exists to keep one promise: the key is stored on THIS DEVICE and
// nowhere else. That is why it is not part of the app state.
//
// Everything in state/ is a candidate for the cloud — persist-cloud.js writes
// the state object to Firestore, merge.js reconciles it across devices, and
// migrate.js carries it forward. A key that lived in there would be synced by
// construction: a credential sitting in someone else's database, copied to
// every device they ever sign in on, and impossible to take back. So it lives
// under its own localStorage key, touched only by the four functions below, and
// the state object never learns it exists.
//
// The other half of the promise is in services/recommend.js, which sends it to
// exactly one place — the Worker — over HTTPS, in a header, and never puts it
// in a URL where it could land in a log or a referrer.
const LS_KEY = 'otherworld_reads_own_key'

// Anthropic keys are `sk-ant-…`. Checked so that a mis-paste — half a key, a
// stray quote, someone's email address — is caught here rather than becoming a
// failed ask that looks like the app being broken.
const SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,}$/

export const looksLikeKey = (value) => SHAPE.test(String(value || '').trim())

export function readOwnKey(){
  try{
    const raw = localStorage.getItem(LS_KEY)
    return looksLikeKey(raw) ? raw.trim() : ''
  }catch(e){ return '' }  // private mode: no key, not an error
}

export const hasOwnKey = () => !!readOwnKey()

// Returns false when the value isn't a key, so the caller can say so rather
// than storing something that will fail on the next ask.
export function saveOwnKey(value){
  const key = String(value || '').trim()
  if(!looksLikeKey(key)) return false
  try{
    localStorage.setItem(LS_KEY, key)
    return true
  }catch(e){ return false }
}

export function clearOwnKey(){
  try{ localStorage.removeItem(LS_KEY) }catch(e){ /* nothing to remove */ }
}
