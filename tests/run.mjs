// Every test, one command:
//
//   node tests/run.mjs
//
// No dependencies and no config, because the app has none — a suite that needs
// an install is a suite that stops being run. Exits non-zero on failure, so it
// works as a pre-push hook or a CI step unchanged.
import { readdirSync } from 'node:fs'
import { report } from './harness.mjs'

const files = readdirSync(new URL('.', import.meta.url))
  .filter(f => f.endsWith('.test.mjs'))
  .sort()

console.log(`\n  Otherworld Bookshelf — ${files.length} test files\n`)

for(const f of files){
  // Sequential on purpose: the harness collects into one shared list, and
  // interleaved suites would report under the wrong heading.
  await import(`./${f}`)
}

process.exit(await report() ? 0 : 1)
