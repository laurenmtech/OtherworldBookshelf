// The tab bar: a bottom bar on a phone, plain text links in the header above
// the wide breakpoint. One DOM node either way — the move is done in CSS, so
// there is no relocation to get wrong and no duplicate set of links.
//
// The bar carries no badges, no counts and no dots, and it is not going to.
// An app with no streaks doesn't get to put a red number on its own navigation:
// this is a way to get somewhere, not a reason to. Written down here because
// the first feature that wants a badge will look for permission in this file.
import { el } from '../ui/dom.js'

// Adding the third tab in Phase 11 is one entry in this array plus a route.
export const TABS = [
  { path: '/', label: 'Reading', icon: '📖' },
  { path: '/finished', label: 'Finished', icon: '✓' }
]

export function mountTabBar(root){
  if(!root) return { setActive(){} }

  const links = TABS.map(tab => {
    const a = el('a', { className: 'tab-link', href: '#' + tab.path },
      el('span', { className: 'tab-icon', 'aria-hidden': 'true' }, tab.icon),
      el('span', { className: 'tab-label' }, tab.label)
    )
    a.dataset.path = tab.path
    return a
  })

  root.innerHTML = ''
  links.forEach(a => root.appendChild(a))

  return {
    setActive(path){
      links.forEach(a => {
        const active = a.dataset.path === path
        // aria-current is what a screen reader reads as "current page"; the
        // class is only paint.
        if(active) a.setAttribute('aria-current', 'page')
        else a.removeAttribute('aria-current')
        a.classList.toggle('active', active)
      })
    }
  }
}
