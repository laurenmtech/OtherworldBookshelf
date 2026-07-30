// Vibe audit: every vibe must define the whole token contract, and every
// text/background pair a reader actually looks at must pass WCAG AA.
//
//   node styles/vibes/audit.mjs          report
//   node styles/vibes/audit.mjs --write  report + rewrite CONTRAST.md
//
// Exits non-zero on a missing token or a failing pair, so a vibe can't ship
// looking almost right. Run it after touching any file in this directory.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STYLES = join(HERE, '..')

// ---------- colour ----------

function parse(c){
  c = String(c).trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(c)
  if(m){
    let h = m[1]
    if(h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('')
    const n = p => parseInt(h.slice(p, p + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c)
  if(m){
    const p = m[1].split(',').map(s => parseFloat(s.trim()))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  return null
}

// Flatten a translucent colour onto an opaque one.
function over(fg, bg){
  if(fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  }
}

function luminance({ r, g, b }){
  const f = v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(fg, bg){
  const a = luminance(fg), b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- parsing the stylesheets ----------

function tokensFrom(css, selector){
  const start = css.indexOf(selector)
  if(start < 0) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const out = {}
  for(const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim()
  return out
}

const base = tokensFrom(readFileSync(join(STYLES, 'tokens.css'), 'utf8'), ':root')
const CONTRACT = Object.keys(base)

const vibes = [{ id: 'otherworld', tokens: base, file: 'styles/tokens.css (:root)' }]
for(const f of readdirSync(HERE).filter(f => f.endsWith('.css')).sort()){
  const id = f.replace(/\.css$/, '')
  const css = readFileSync(join(HERE, f), 'utf8')
  const t = tokensFrom(css, `html[data-vibe="${id}"]`)
  if(!t){ console.log(`✗ ${f}: no html[data-vibe="${id}"] block`); process.exitCode = 1; continue }
  vibes.push({ id, tokens: t, file: `styles/vibes/${f}` })
}

// ---------- the pairs a reader actually looks at ----------
// AA is 4.5:1 for normal text. Everything here is normal-size text or a
// control label, so nothing gets the 3:1 large-text allowance.

const PAIRS = [
  ['body text', '--ink', 'panel'],
  ['secondary text', '--muted', 'panel'],
  ['headings / buttons', '--accent', 'panel'],
  ['titles', '--accent-2', 'panel'],
  ['destructive button', '--danger', 'panel'],
  ['body text on a card', '--ink', '--card'],
  ['secondary on a card', '--muted', '--card'],
  ['chip label', '--muted', 'sunken'],
  ['primary button label', '--on-accent', '--accent'],
  ['primary button label (far end)', '--on-accent', '--accent-2'],
]

const AA = 4.5
let failures = 0
const report = []

for(const { id, tokens, file } of vibes){
  const missing = CONTRACT.filter(t => !(t in tokens))
  const rows = []

  if(missing.length){
    failures++
    rows.push({ missing })
  }

  // Panels and inputs are translucent overlays; composite them so the numbers
  // describe what is actually on screen rather than the token in isolation.
  const bg2 = parse(tokens['--bg-2'])
  const panel = bg2 ? over(parse(tokens['--surface-2']) || bg2, bg2) : null
  const sunken = bg2 ? over(parse(tokens['--sunken']) || bg2, panel || bg2) : null
  const resolve = k => k === 'panel' ? panel : k === 'sunken' ? sunken : (() => {
    const c = parse(tokens[k])
    return c && c.a < 1 ? over(c, bg2) : c
  })()

  for(const [label, fgKey, bgKey] of PAIRS){
    const fg = resolve(fgKey), bg = resolve(bgKey)
    if(!fg || !bg){ rows.push({ label, r: null }); failures++; continue }
    const r = ratio(fg, bg)
    if(r < AA) failures++
    rows.push({ label, r, pass: r >= AA })
  }

  report.push({ id, file, missing, rows })
}

// ---------- output ----------

for(const v of report){
  console.log(`\n${v.id}`)
  if(v.missing.length) console.log(`  ✗ missing tokens: ${v.missing.join(', ')}`)
  for(const row of v.rows){
    if(row.missing) continue
    const n = row.r == null ? 'unparseable' : row.r.toFixed(2) + ':1'
    console.log(`  ${row.pass ? '✓' : '✗'} ${row.label.padEnd(32)} ${n}`)
  }
}
console.log(`\n${failures ? `${failures} failure(s)` : 'all vibes define the full contract and pass WCAG AA'}`)

if(process.argv.includes('--write')){
  const lines = [
    '# Vibe contrast audit',
    '',
    'Generated by `node styles/vibes/audit.mjs --write`. Every pair below is',
    'normal-size text or a control label, so the bar is WCAG **AA 4.5:1** —',
    'none of it qualifies for the 3:1 large-text allowance.',
    '',
    'Panels and inputs are translucent, so those values are composited over the',
    'vibe\'s background before measuring: the numbers describe what is actually',
    'on screen, not the token in isolation.',
    '',
    '| Vibe | ' + PAIRS.map(p => p[0]).join(' | ') + ' |',
    '|---|' + PAIRS.map(() => '---').join('|') + '|',
    ...report.map(v => `| ${v.id} | ` + v.rows.map(r =>
      r.r == null ? '—' : `${r.r.toFixed(2)}${r.pass ? '' : ' ✗'}`).join(' | ') + ' |'),
    '',
  ]
  writeFileSync(join(HERE, 'CONTRAST.md'), lines.join('\n'))
  console.log('\nwrote styles/vibes/CONTRAST.md')
}

process.exit(failures ? 1 : 0)
