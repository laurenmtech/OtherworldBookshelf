// Hash routing. Owns the three things every route change must do: swap the visible
// section, restore that route's scroll, move focus to its heading.
function normalize(hash){
  let path = String(hash || '').replace(/^#/, '')
  if(!path.startsWith('/')) path = '/' + path
  if(path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

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

export function createRouter({ routes, fallback = '/', onChange } = {}){
  const paths = routes.map(r => r.path)
  if(!paths.includes(fallback)) throw new Error(`router: fallback "${fallback}" is not a route`)

  const scrollTops = new Map()
  let current = null
  let firstRender = true

  function apply(){
    const path = normalize(location.hash)
    const found = match(path, paths)

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

    window.scrollTo(0, scrollTops.get(next.path) || 0)

    if(!firstRender){
      const heading = next.el.querySelector('[data-route-heading]')
      if(heading && typeof heading.focus === 'function') heading.focus()
    }
    firstRender = false

    if(onChange) onChange(found.path, found.params)
  }

  routes.forEach(r => { r.el.hidden = true })

  window.addEventListener('hashchange', apply)
  apply()

  return {
    get path(){ return current ? current.path : fallback },
    navigate(path){ location.hash = '#' + path }
  }
}
