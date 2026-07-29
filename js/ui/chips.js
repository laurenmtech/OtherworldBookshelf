// The selectable-chip control used by the finish modal.
// Single-select (feelings) and multi-select (moods) share one implementation.

// options: [{ key, label }] or ['Label', …]
// Returns { getValue, setValue, clear } — single-select value is a key or null.
export function singleSelect(container, options, { onChange } = {}){
  const opts = options.map(o => (typeof o === 'string' ? { key: o, label: o } : o))
  let value = null
  if(!container) return { getValue: () => null, setValue(){}, clear(){} }

  container.innerHTML = ''
  const buttons = opts.map(o => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = o.label
    b.addEventListener('click', () => {
      value = (value === o.key) ? null : o.key
      paint()
      if(onChange) onChange(value)
    })
    container.appendChild(b)
    return b
  })

  function paint(){ buttons.forEach((b, i) => b.classList.toggle('selected', opts[i].key === value)) }

  return {
    getValue: () => value,
    setValue(v){ value = v; paint() },
    clear(){ value = null; paint() }
  }
}

// Returns { getValue, setValue, clear } — multi-select value is an array of keys.
export function multiSelect(container, options, { onChange } = {}){
  const opts = options.map(o => (typeof o === 'string' ? { key: o, label: o } : o))
  const chosen = new Set()
  if(!container) return { getValue: () => [], setValue(){}, clear(){} }

  container.innerHTML = ''
  const buttons = opts.map(o => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = o.label
    b.addEventListener('click', () => {
      if(chosen.has(o.key)) chosen.delete(o.key); else chosen.add(o.key)
      b.classList.toggle('selected', chosen.has(o.key))
      if(onChange) onChange(Array.from(chosen))
    })
    container.appendChild(b)
    return b
  })

  function paint(){ buttons.forEach((b, i) => b.classList.toggle('selected', chosen.has(opts[i].key))) }

  return {
    getValue: () => Array.from(chosen),
    // Used when the option set is rebuilt from data and a selection has to
    // survive the rebuild. Keys no longer on offer are simply dropped.
    setValue(keys){
      chosen.clear()
      for(const k of keys || []) if(opts.some(o => o.key === k)) chosen.add(k)
      paint()
    },
    clear(){ chosen.clear(); paint() }
  }
}
