// What the month has cost so far, and the ceiling it stops at.
//
// One integer in KV per UTC month. Not per reader — this is the bill, and the
// bill doesn't care who ran it up. It holds no titles, no prompts, no uid and
// no request count anyone could work backwards from: a single running total.
//
// The counter is in MICRO-DOLLARS (millionths of a dollar), stored as an
// integer, because a single ask costs around ten cents and floats accumulated a
// hundred times drift in the last digits. Integers don't.

// Dollars per million tokens, from the published price list. Kept here rather
// than derived, because the arithmetic in README.md's cost table is checked
// against real invoices and these numbers are what makes it checkable.
//
// `in` is the base input rate; cache reads bill at 0.1x it and cache writes at
// 1.25x. Nothing in this Worker uses prompt caching today, so those two are
// always zero — they are priced anyway so that the day someone adds caching,
// the ledger stays true instead of quietly under-reporting.
export const PRICES = {
  'claude-opus-5':    { in: 5, out: 25 },
  'claude-sonnet-5':  { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 }
}

// An unpriced model bills at the most expensive rate we know rather than at
// zero. Getting the model id wrong should make the ceiling arrive EARLY. The
// alternative — an unknown model costing nothing — turns a typo into an
// uncapped month, which is the exact failure this file exists to prevent.
const DEAREST = Object.values(PRICES)
  .reduce((a, b) => (b.out > a.out ? b : a))

// Tokens x dollars-per-million, in micro-dollars, is just tokens x price: the
// 1e6 divide and the 1e6 multiply cancel. Rounded UP, so a month of small asks
// can never total less than it cost.
export function costMicros(model, usage = {}){
  const p = PRICES[model] || DEAREST
  const micros =
    (usage.input_tokens || 0) * p.in +
    (usage.output_tokens || 0) * p.out +
    (usage.cache_read_input_tokens || 0) * p.in * 0.1 +
    (usage.cache_creation_input_tokens || 0) * p.in * 1.25
  return Math.ceil(micros)
}

// UTC, matching quota.js. "The 1st" in the message a reader sees is the 1st in
// the same time zone the counter resets in, which is the only way that sentence
// is true for everyone.
export const monthKey = () => new Date().toISOString().slice(0, 7)

const keyFor = () => `m:${monthKey()}`

// Long enough that a month's key survives the month, short enough that old
// months disappear on their own. Nothing reads a previous month.
const TTL_SECONDS = 60 * 60 * 24 * 70

export const budgetMicros = (env) => {
  const usd = Number(env.MONTHLY_BUDGET_USD)
  return usd > 0 ? Math.round(usd * 1e6) : 0
}

export async function readSpent(kv){
  const raw = await kv.get(keyFor())
  const n = raw == null ? 0 : parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// True when the month is spent. A budget of 0 (unset, or misconfigured to
// something that isn't a positive number) means NO ceiling — the Worker
// behaves exactly as it did before this file existed. That is the deliberate
// choice: a config typo should not take the recommender off the air.
export async function overBudget(kv, env){
  const cap = budgetMicros(env)
  if(!cap) return false
  return (await readSpent(kv)) >= cap
}

// Recorded AFTER the call, because the cost isn't knowable until the response
// reports its tokens. So the ceiling is always crossed by one ask rather than
// stopped at it, and — like quota.js — this is read-then-write with nothing
// holding the two together, so simultaneous asks can lose an increment.
//
// Both are accepted here for the same reason: the overshoot is cents, and the
// account-level spend limit on the Anthropic side is the backstop that doesn't
// depend on this file being right.
export async function addSpent(kv, micros){
  if(!(micros > 0)) return
  try{
    const next = (await readSpent(kv)) + micros
    await kv.put(keyFor(), String(next), { expirationTtl: TTL_SECONDS })
    return next
  }catch(e){ /* an unrecorded ask is better than a failed response */ }
}
