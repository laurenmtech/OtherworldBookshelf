// The backend. api/README.md calls out decisions here as load-bearing; these
// are the tests it refers to.
//
// Nothing here touches the network. Tokens are malformed on purpose so
// verifyIdToken() rejects on shape before it would ever fetch a signing key.
import { readFileSync, readdirSync } from 'node:fs'
import { suite, test, is, ok } from './harness.mjs'
import { shape, slug, sameTitle } from '../api/src/series.js'
import { claim, refund, readUsed, DAILY_CAP } from '../api/src/quota.js'
import worker from '../api/src/index.js'

// ── The self-consistency guard ──────────────────────────────────────────────

suite('worker: series answer guard')

const TOG = ['Throne of Glass', 'Crown of Midnight', 'Heir of Fire', 'Queen of Shadows',
             'Empire of Storms', 'Tower of Dawn', 'Kingdom of Ash']

// THE regression. Asked about Heir of Fire, the model returned Crescent City's
// volume list. A list that doesn't contain the book we asked about is about
// some other series, and the whole answer is thrown away.
test('a list without the queried book is rejected', () =>
  is(shape({ inSeries: true, seriesName: 'Crescent City',
    volumes: ['House of Earth and Blood', 'House of Sky and Breath', 'House of Flame and Shadow'] },
    'Heir of Fire'), null))

test('a consistent list is accepted', () =>
  ok(shape({ inSeries: true, seriesName: 'Throne of Glass', volumes: TOG }, 'Heir of Fire')))
test('position is derived from the list, never claimed', () =>
  is(shape({ inSeries: true, seriesName: 'Throne of Glass', volumes: TOG }, 'Heir of Fire').position, 3))
test('total is the list length', () =>
  is(shape({ inSeries: true, seriesName: 'Throne of Glass', volumes: TOG }, 'Heir of Fire').total, 7))
test('the key matches the client slug', () =>
  is(shape({ inSeries: true, seriesName: 'Throne of Glass', volumes: TOG }, 'Heir of Fire').key, 'throne-of-glass'))
test('a catalogue-style longer title still matches', () =>
  is(shape({ inSeries: true, seriesName: 'Throne of Glass',
    volumes: ['Throne of Glass', 'Crown of Midnight', 'Heir of Fire: A Throne of Glass Novel'] },
    'Heir of Fire').position, 3))
test('a standalone is null', () =>
  is(shape({ inSeries: false, seriesName: '', volumes: [] }, 'Piranesi'), null))
test('a one-book series is null', () =>
  is(shape({ inSeries: true, seriesName: 'X', volumes: ['Piranesi'] }, 'Piranesi'), null))
test('an empty series name is null', () =>
  is(shape({ inSeries: true, seriesName: '', volumes: TOG }, 'Heir of Fire'), null))
test('a very long series is capped', () =>
  is(shape({ inSeries: true, seriesName: 'Discworld',
    volumes: Array.from({ length: 41 }, (_, i) => `Disc ${i + 1}`) }, 'Disc 5').total, 30))

// ── The quota credit is claimed BEFORE the model is called ──────────────────

suite('worker: quota')

function fakeKV(){
  const store = new Map()
  return {
    store,
    async get(k){ return store.has(k) ? store.get(k) : null },
    async put(k, v){ store.set(k, v) }
  }
}

test('a claim increments the counter', async () => {
  const kv = fakeKV()
  const a = await claim(kv, 'u1', 3)
  return is(a.ok, true) && is(await readUsed(kv, 'u1'), 1)
})
test('claims stop at the cap', async () => {
  const kv = fakeKV()
  for(let i = 0; i < 3; i++) await claim(kv, 'u1', 3)
  return is((await claim(kv, 'u1', 3)).ok, false)
})
test('remaining counts down', async () => {
  const kv = fakeKV()
  return is((await claim(kv, 'u1', 3)).remaining, 2)
})
test('a refund gives the credit back', async () => {
  const kv = fakeKV()
  await claim(kv, 'u1', 3)
  await refund(kv, 'u1', 3)
  return is(await readUsed(kv, 'u1'), 0)
})
// Series lookups must not spend a reader's recommendation allowance.
test('series lookups use a separate counter', async () => {
  const kv = fakeKV()
  await claim(kv, 'u1', 60, 's')
  return is(await readUsed(kv, 'u1'), 0) && is(await readUsed(kv, 'u1', 's'), 1)
})

// ── The uid comes from the verified token, never the request body ───────────

suite('worker: identity and routing')

const ENV = { FIREBASE_PROJECT_ID: 'books-7a105', ALLOWED_ORIGINS: 'https://example.test', QUOTA: fakeKV() }
const post = (path, body, headers = {}) =>
  worker.fetch(new Request(`https://w.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }), ENV)

test('an unauthenticated call is refused', async () => is((await post('/series', { title: 'x' })).status, 401))

// The one this file exists for: a caller can put any uid in the JSON they post.
test('a uid in the body buys nothing', async () =>
  is((await post('/series', { title: 'x', uid: 'someone-else' })).status, 401))
test('same for /recommend', async () =>
  is((await post('/recommend', { uid: 'someone-else' })).status, 401))
test('a malformed bearer token is refused', async () =>
  is((await post('/series', { title: 'x' }, { Authorization: 'Bearer not.a.jwt' })).status, 401))
test('the refusal says nothing about which check failed', async () => {
  const body = await (await post('/series', { title: 'x' })).json()
  return is(body.error.type, 'unauthenticated')
})

test('an unknown route is 404', async () => is((await post('/nope', {})).status, 404))
test('a GET to a real route is a bad request', async () =>
  is((await worker.fetch(new Request('https://w.test/series', { method: 'GET' }), ENV)).status, 400))
test('a preflight is answered', async () =>
  is((await worker.fetch(new Request('https://w.test/series', { method: 'OPTIONS' }), ENV)).status, 204))

// A wildcard here would let any site spend a signed-in reader's daily quota.
test('an allowed origin is echoed', async () => {
  const r = await post('/series', { title: 'x' }, { Origin: 'https://example.test' })
  return is(r.headers.get('access-control-allow-origin'), 'https://example.test')
})
test('a disallowed origin is NOT echoed', async () => {
  const r = await post('/series', { title: 'x' }, { Origin: 'https://evil.test' })
  return is(r.headers.get('access-control-allow-origin'), 'https://example.test')
})

// ── Nothing about what anyone reads is ever logged ──────────────────────────

suite('worker: keeps no record')

test('no console calls anywhere in the Worker', () => {
  const offenders = []
  for(const f of readdirSync('api/src')){
    if(!f.endsWith('.js')) continue
    const src = readFileSync(`api/src/${f}`, 'utf8')
    for(const [i, line] of src.split('\n').entries()){
      if(line.trim().startsWith('//')) continue
      if(/\bconsole\s*\./.test(line)) offenders.push(`${f}:${i + 1}`)
    }
  }
  return is(offenders.join(', '), '', 'console calls found')
})
