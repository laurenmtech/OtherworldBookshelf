// Who is calling, proved rather than claimed.
//
// The Firebase Admin SDK does not run on Workers — it wants Node crypto and
// gRPC. It isn't needed: Google publishes the token-signing keys as JWKS, in
// exactly the shape WebCrypto's importKey('jwk', …) accepts, so verification is
// a signature check and six claim comparisons with no dependencies at all.
//
//   https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
//
// The whole point of this file: the user id comes from a SIGNATURE, never from
// the request body. A caller can put any uid they like in the JSON they post
// and it changes nothing — `sub` from the verified token is the only identity
// this Worker will act on.

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

// Google serves these with a multi-hour max-age and rotates them slowly. Held
// per isolate: a cold start costs one fetch, everything after is free. Refetched
// once when a token arrives signed by a key we don't have — which is what key
// rotation looks like from here.
let cachedKeys = null
let cachedAt = 0
const KEY_TTL_MS = 60 * 60 * 1000

async function jwks(force = false){
  const now = Date.now()
  if(!force && cachedKeys && (now - cachedAt) < KEY_TTL_MS) return cachedKeys
  const res = await fetch(JWKS_URL)
  if(!res.ok) throw new Error(`jwks: ${res.status}`)
  const data = await res.json()
  cachedKeys = Array.isArray(data.keys) ? data.keys : []
  cachedAt = now
  return cachedKeys
}

function b64urlToBytes(s){
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlToJson(s){
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)))
}

async function findKey(kid, force){
  const keys = await jwks(force)
  return keys.find(k => k.kid === kid) || null
}

// Returns the verified uid, or throws. Every throw is the same to the caller —
// a 401 — because telling an unauthenticated caller *why* their token failed
// is telling them how to forge a better one.
export async function verifyIdToken(token, projectId){
  if(typeof token !== 'string' || !token) throw new Error('no token')
  const parts = token.split('.')
  if(parts.length !== 3) throw new Error('malformed')

  const [rawHeader, rawPayload, rawSignature] = parts
  const header = b64urlToJson(rawHeader)

  // Only RS256. Refusing everything else is what makes the "alg: none" and
  // HMAC-confusion attacks impossible rather than merely unlikely.
  if(header.alg !== 'RS256') throw new Error('alg')
  if(!header.kid) throw new Error('kid')

  let jwk = await findKey(header.kid, false)
  if(!jwk) jwk = await findKey(header.kid, true)   // key rotated — refetch once
  if(!jwk) throw new Error('unknown kid')

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  )
  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(rawSignature), signed
  )
  if(!ok) throw new Error('signature')

  const claims = b64urlToJson(rawPayload)
  const now = Math.floor(Date.now() / 1000)
  // A little slack, because the client's clock and Google's are not the same
  // clock and a token minted one second ago should not be "not yet valid".
  const SKEW = 60

  if(claims.aud !== projectId) throw new Error('aud')
  if(claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss')
  if(typeof claims.exp !== 'number' || claims.exp <= now - SKEW) throw new Error('expired')
  if(typeof claims.iat !== 'number' || claims.iat > now + SKEW) throw new Error('iat')
  if(claims.auth_time != null && claims.auth_time > now + SKEW) throw new Error('auth_time')
  if(typeof claims.sub !== 'string' || !claims.sub) throw new Error('sub')

  return claims.sub
}

// Test seam. Nothing else should touch the module-level cache.
export function resetKeyCache(){ cachedKeys = null; cachedAt = 0 }
