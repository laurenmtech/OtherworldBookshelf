// The whole test framework. No dependencies, because the app has none and a
// test suite that needs an install is a test suite that stops being run.
//
// Each *.test.mjs file exports nothing and simply calls test(); run.mjs imports
// them all and reports. Node runs them directly:  node tests/run.mjs
//
// ASYNC TESTS ARE AWAITED. The first version of this file checked the return
// value synchronously, so an async test resolved to a truthy promise and was
// counted as a pass whatever it actually did — thirty Worker tests that could
// not fail. A suite that cannot fail is worse than no suite, so `test` now
// captures the promise and `report` awaits every one before tallying.

let current = null
const results = []
const pending = []

export function suite(name){
  current = { name, pass: 0, fail: 0, failures: [] }
  results.push(current)
}

export function test(name, fn){
  const s = current   // captured now: later suites must not steal this result
  const record = (err) => {
    if(err === null){ s.pass++; return }
    s.fail++
    s.failures.push(`${name} — ${err && err.message ? err.message : err}`)
  }
  let out
  try{
    out = fn()
  }catch(err){
    record(err)
    return
  }
  if(out && typeof out.then === 'function'){
    pending.push(out.then(
      v => record(v === false ? new Error('returned false') : null),
      e => record(e)
    ))
    return
  }
  record(out === false ? new Error('returned false') : null)
}

// Deliberately tiny. `is` covers primitives, `same` covers anything with a
// stable JSON shape, and everything else is an expression that must be true.
export function is(actual, expected, what = ''){
  if(actual !== expected){
    throw new Error(`${what ? what + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  return true
}

export function same(actual, expected, what = ''){
  const a = JSON.stringify(actual), b = JSON.stringify(expected)
  if(a !== b) throw new Error(`${what ? what + ': ' : ''}expected ${b}, got ${a}`)
  return true
}

export function ok(value, what = ''){
  if(!value) throw new Error(`${what || 'expected truthy'}, got ${JSON.stringify(value)}`)
  return true
}

export async function report(){
  await Promise.all(pending)
  let pass = 0, fail = 0
  for(const s of results){
    pass += s.pass; fail += s.fail
    const mark = s.fail ? '✗' : '✓'
    console.log(`  ${mark} ${s.name.padEnd(38)} ${s.pass} passed${s.fail ? `, ${s.fail} FAILED` : ''}`)
    for(const f of s.failures) console.log(`      ${f}`)
  }
  console.log(`\n  ${pass} passed, ${fail} failed`)
  return fail === 0
}
