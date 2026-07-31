// How many asks a day, per reader.
//
// One counter per user per UTC day, in Workers KV. One write per call keeps
// usage linear and predictable against KV's free-tier write budget (~1k/day) —
// the moment this needs anything cleverer than a counter, it needs a Durable
// Object instead, and that's the signal to look for.
//
// The key holds no book titles, no prompts, no results. Just a number. That is
// the entire record this backend keeps of anyone.

export const DAILY_CAP = 10

// UTC rather than local time, deliberately: "your day" is ambiguous across
// devices and time zones, and a reset that moves when you travel is worse than
// one that's occasionally at an odd hour.
function today(){
  return new Date().toISOString().slice(0, 10)
}

const keyFor = (uid) => `q:${uid}:${today()}`

// Two days, so yesterday's counter disappears on its own rather than
// accumulating a row per user per day forever.
const TTL_SECONDS = 60 * 60 * 48

export async function readUsed(kv, uid){
  const raw = await kv.get(keyFor(uid))
  const n = raw == null ? 0 : parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// Take one ask, if there is one to take.
//
// The credit is claimed BEFORE the model is called, not after. KV has no
// transactions, so a check-then-call-then-increment would leave the whole model
// call — seconds — sitting between the check and the increment, and every
// request arriving in that window would pass a check only one of them should.
// Claiming first narrows that window to a single KV round trip.
//
// It does NOT close it. This is still read-then-write with nothing holding the
// two together: two requests that read the same count will both write count+1
// and both proceed. KV is also eventually consistent between regions, so a
// reader on two networks can see a stale count for up to a minute. The cap is
// therefore a strong nudge, not an enforced ceiling — someone determined, or
// merely double-tapping on a bad connection, can exceed it by a little.
//
// That is an accepted trade for a personal app: the failure costs pennies, and
// the fix is a Durable Object, which is the thing to reach for the moment this
// needs to be exact. refund() below covers the honest failure case.
export async function claim(kv, uid, cap = DAILY_CAP){
  const used = await readUsed(kv, uid)
  if(used >= cap) return { ok: false, used, remaining: 0 }
  const next = used + 1
  await kv.put(keyFor(uid), String(next), { expirationTtl: TTL_SECONDS })
  return { ok: true, used: next, remaining: Math.max(0, cap - next) }
}

// Best-effort: give the credit back when the model call failed, so an upstream
// outage doesn't quietly eat someone's allowance. Best-effort is the honest
// word — if the Worker dies between claiming and refunding, that ask is spent.
// Losing one credit to a crash is a better failure than double-spending a
// credit to a race.
export async function refund(kv, uid, cap = DAILY_CAP){
  try{
    const used = await readUsed(kv, uid)
    if(used <= 0) return
    const next = used - 1
    await kv.put(keyFor(uid), String(next), { expirationTtl: TTL_SECONDS })
    return Math.max(0, cap - next)
  }catch(e){ /* the ask is spent; not worth failing the response over */ }
}
