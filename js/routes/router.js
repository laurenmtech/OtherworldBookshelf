// Hash routing.
//
// Hash fragments rather than the History API: they need no server rewrite
// rules, which is what keeps this deployable to GitHub Pages unchanged. The
// matcher understands `:param` segments even though nothing uses them yet —
// Phase 11's `#/club/<code>` is the reason, and supporting it now costs a
// dozen lines rather than a rewrite later.
//
// The router owns the three things every route change must do — swap which
// section is visible, restore that route's scroll position, and move focus to
// its heading — so no individual route has to remember them.

// '' | '#' | '#/' -> '/'   ·   '#/finished/' -> '/finished'
function normalize(hash){
  let path = String(hash || '').replace(/^#/, '')
  if(!path.startsWith('/')) path = '/' + path
  if(path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

// Exact matches win; `:param` patterns are only tried if nothing matched
// literally, so a future '/club/new' can coexist with '/club/:code'.
function match(path, paths){
  if(paths.includes(path)) return { path, params: {} }
  const segs = path.split('/')
  for(const pattern of paths){
    if(!pattern.includes(':')) continue
    const pSegs = pattern.split('/')
    if(pSegs.length !== segs.length) continue
    const params = {}
    let ok = true
    for(let i = 0; i < pSegs.length; i++){
      if(pSegs[i].startsWith(':')) params[pSegs[i].slice(1)] = decodeURIComponent(segs[i])
      else if(pSegs[i] !== segs[i]){ ok = false; break }
    }
    if(ok) return { path: pattern, params }
  }
  return null
}

// routes: [{ path, el, enter?(params), leave?() }]
// onChange(path) fires after every successful navigation — the tab bar's cue.
export function createRouter({ routes, fallback = '/', onChange } = {}){
  const paths = routes.map(r => r.path)
  if(!paths.includes(fallback)) throw new Error(`router: fallback "${fallback}" is not a route`)

  const scrollTops = new Map()
  let current = null
  let firstRender = true

  function apply(){
    const path = normalize(location.hash)
    const found = match(path, paths)

    // Unknown route -> Reading. replaceState so the bad URL doesn't become a
    // history entry the back button can land on again.
    if(!found){
      history.replaceState(null, '', '#' + fallback)
      return apply()
    }

    const next = routes.find(r => r.path === found.path)
    if(current === next){
      if(onChange) onChange(found.path, found.params)
      return
    }

    if(current){
      scrollTops.set(current.path, window.scrollY)
      current.el.hidden = true
      if(current.leave) current.leave()
    }

    next.el.hidden = false
    if(next.enter) next.enter(found.params)
    current = next

    // Restore where this tab was left, defaulting to the top. After the
    // section is visible, so the document is tall enough to scroll into.
    window.scrollTo(0, scrollTops.get(next.path) || 0)

    // Announce the new view — but never steal focus on the initial paint.
    if(!firstRender){
      const heading = next.el.querySelector('[data-route-heading]')
      if(heading && typeof heading.focus === 'function') heading.focus()
    }
    firstRender = false

    if(onChange) onChange(found.path, found.params)
  }

  // Start from a known state: without this, a cold start on #/finished would
  // reveal the Finished section while leaving Reading — which is not hidden in
  // the markup — showing underneath it.
  routes.forEach(r => { r.el.hidden = true })

  window.addEventListener('hashchange', apply)
  apply()

  return {
    get path(){ return current ? current.path : fallback },
    navigate(path){ location.hash = '#' + path }
  }
}
