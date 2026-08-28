// The backend. api/README.md calls out decisions here as load-bearing; these
// are the tests it refers to.
//
// Nothing here touches the network. Tokens are malformed on purpose so
// verifyIdToken() rejects on shape before it would ever fetch a signing key.
import { readFileSync, readdirSync } from 'node:fs'
import { suite, test, is, ok } from './harness.mjs'
import { shape, slug, sameTitle, fanOut, cacheKey } from '../api/src/series.js'
import { claim, refund, readUsed, DAILY_CAP } from '../api/src/quota.js'
import { costMicros, addSpent, readSpent, overBudget, budgetMicros, PRICES } from '../api/src/budget.js'
import { takesEffort } from '../api/src/recommend.js'
import worker, { handleRecommend } from '../api/src/index.js'

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

// ── One answer, cached for every volume it names ────────────────────────────
//
// Without this, seven books in one series cost seven Haiku calls and gave the
// model seven independent chances to be wrong. Three of them were, on a real
// shelf.

suite('worker: one lookup fills the series')

const vol = (title, { verified = true, author = 'Sarah J. Maas' } = {}) =>
  verified ? { title, author, verified: true } : { title, verified: false }

const resolved = (volumes) => ({
  key: 'throne-of-glass', name: 'Throne of Glass',
  position: 1, total: volumes.length, volumes
})

const asked = { key: cacheKey('Throne of Glass', 'Sarah J. Maas'), author: 'Sarah J. Maas' }
const spread = fanOut(resolved(TOG.map(t => vol(t))), asked)

test('every other volume gets an entry', () => is(spread.length, 6))

test('the queried book is not written twice', () =>
  ok(spread.every(w => w.key !== asked.key)))

test('each entry carries its own position', () =>
  is(spread.find(w => w.key.includes('heir-of-fire')).series.position, 3))

test('the volume that was being dropped gets one too', () =>
  is(spread.find(w => w.key.includes('tower-of-dawn')).series.position, 6))

test('each entry carries the whole list, so it can advance', () =>
  ok(spread.every(w => w.series.volumes.length === 7)))

test('the series name and key are unchanged', () =>
  ok(spread.every(w => w.series.key === 'throne-of-glass' && w.series.name === 'Throne of Glass')))

// The whole point: the key written here is the key the NEXT request computes.
test('a key matches what the client will ask with', () =>
  ok(spread.some(w => w.key === cacheKey('Kingdom of Ash', 'Sarah J. Maas'))))

test('every volume in the list is now a cache hit', () =>
  ok(TOG.filter(t => t !== 'Throne of Glass').every(t =>
    spread.some(w => w.key === cacheKey(t, 'Sarah J. Maas')))))

// Rule 1: never assert that an unconfirmed book exists.
test('an unverified volume is never cached under its own name', () => {
  const mixed = fanOut(resolved([vol('Throne of Glass'), vol('Crown of Midnight'),
    vol('The Unwritten One', { verified: false })]), asked)
  return ok(mixed.every(w => !w.key.includes('the-unwritten-one')))
})

test('an unverified volume still holds its place in the list', () => {
  const mixed = fanOut(resolved([vol('Throne of Glass'), vol('Crown of Midnight'),
    vol('The Unwritten One', { verified: false })]), asked)
  return is(mixed[0].series.volumes.length, 3)
})

// Rule 2: keyed by the catalogue's author, which is what search sends back.
test('a volume with its own author is keyed by it', () => {
  const co = fanOut(resolved([vol('One'), vol('Two', { author: 'Someone Else' })]), asked)
  return ok(co.some(w => w.key === cacheKey('Two', 'Someone Else')))
})

test('a volume with no author falls back to the queried one', () => {
  const bare = fanOut(resolved([vol('One'), { title: 'Two', verified: true }]), asked)
  return ok(bare.some(w => w.key === cacheKey('Two', 'Sarah J. Maas')))
})

test('a series of nothing verified writes nothing', () =>
  is(fanOut(resolved(TOG.map(t => vol(t, { verified: false }))), asked).length, 0))

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

// ── The month's ceiling ─────────────────────────────────────────────────────

suite('worker: monthly budget')

// The README's cost table says ~10¢ per ask, measured against a real invoice
// with ~400 input and ~3,900 output tokens. If this test moves, the table is
// wrong or the prices changed — re-measure rather than adjusting the number.
test('an ask prices out at the measured ~10¢', () =>
  is(costMicros('claude-opus-5', { input_tokens: 400, output_tokens: 3900 }), 99500))
test('a series lookup is a tenth of a cent', () =>
  is(costMicros('claude-haiku-4-5', { input_tokens: 60, output_tokens: 300 }) < 2000, true))

// A typo'd model id must not cost zero. Free is the one answer that turns a
// misconfiguration into an uncapped month.
test('an unpriced model bills at the dearest known rate', () =>
  is(costMicros('claude-nonesuch', { input_tokens: 400, output_tokens: 3900 }),
     costMicros('claude-opus-5', { input_tokens: 400, output_tokens: 3900 })))
test('no model is priced above the fallback', () =>
  is(Object.values(PRICES).every(p => p.out <= 25), true))

test('spend accumulates across asks', async () => {
  const kv = fakeKV()
  await addSpent(kv, 99500)
  await addSpent(kv, 99500)
  return is(await readSpent(kv), 199000)
})
test('the ledger key carries no uid', async () => {
  const kv = fakeKV()
  await addSpent(kv, 1)
  return is([...kv.store.keys()].every(k => /^m:\d{4}-\d{2}$/.test(k)), true)
})

test('under the ceiling is not over budget', async () => {
  const kv = fakeKV()
  await addSpent(kv, 5 * 1e6)
  return is(await overBudget(kv, { MONTHLY_BUDGET_USD: '20' }), false)
})
test('at the ceiling is over budget', async () => {
  const kv = fakeKV()
  await addSpent(kv, 20 * 1e6)
  return is(await overBudget(kv, { MONTHLY_BUDGET_USD: '20' }), true)
})
// An absent or unparseable figure means no ceiling — a config typo must not
// take the recommender off the air.
test('an unset budget is no ceiling', async () => {
  const kv = fakeKV()
  await addSpent(kv, 9999 * 1e6)
  return is(await overBudget(kv, {}), false) &&
         is(await overBudget(kv, { MONTHLY_BUDGET_USD: 'twenty' }), false)
})
test('a budget converts to micro-dollars', () => is(budgetMicros({ MONTHLY_BUDGET_USD: '20' }), 20000000))

// THE ordering test. A reader turned away by the month's budget has not had an
// ask, and must not lose one of their ten to it — so the budget is checked
// before the credit is claimed. Nothing here reaches the network: the
// over-budget path returns before the model is ever called.
const spentEnv = async (usd, micros) => {
  const kv = fakeKV()
  await addSpent(kv, micros)
  return { QUOTA: kv, MONTHLY_BUDGET_USD: usd }
}

test('a spent month answers 503, not 429', async () => {
  const env = await spentEnv('20', 20 * 1e6)
  return is((await handleRecommend(env, 'u1', {}, {})).status, 503)
})
test('it says which of the two it is', async () => {
  const env = await spentEnv('20', 20 * 1e6)
  const body = await (await handleRecommend(env, 'u1', {}, {})).json()
  return is(body.error.type, 'budget_exhausted')
})
test('a budget stop does NOT spend a daily credit', async () => {
  const env = await spentEnv('20', 20 * 1e6)
  await handleRecommend(env, 'u1', {}, {})
  return is(await readUsed(env.QUOTA, 'u1'), 0)
})
// The mirror of the above: with budget left, the request gets PAST the ceiling
// and on to the model, which fails here because there is no API key — 502, not
// 503. The counter is back at zero afterwards because that failure refunds the
// credit, which is the behaviour quota.js promises and worth pinning too.
test('with budget left it gets past the ceiling to the model', async () => {
  const env = await spentEnv('20', 1e6)
  return is((await handleRecommend(env, 'u1', {}, {})).status, 502)
})
test('and the failed ask gives the credit back', async () => {
  const env = await spentEnv('20', 1e6)
  await handleRecommend(env, 'u1', {}, {})
  return is(await readUsed(env.QUOTA, 'u1'), 0)
})

// ── The effort pin follows the model ────────────────────────────────────────
//
// Haiku 4.5 rejects output_config.effort with a 400. Sending the pin to it
// would break the exact swap the MODEL config value exists to make possible —
// the cost lever would fail closed, on every ask, the moment it was pulled.

suite('worker: effort follows the model')

test('the default model takes the pin', () => is(takesEffort('claude-opus-5'), true))
test('Haiku 4.5 does NOT take the pin', () => is(takesEffort('claude-haiku-4-5'), false))
test('an unknown model is assumed not to', () => is(takesEffort('claude-nonesuch'), false))

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
