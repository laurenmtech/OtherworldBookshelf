// The two tabs: bottom bar on a phone, header links when there's room.
import { el } from '../ui/dom.js'

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
        if(active) a.setAttribute('aria-current', 'page')
        else a.removeAttribute('aria-current')
        a.classList.toggle('active', active)
      })
    }
  }
}
