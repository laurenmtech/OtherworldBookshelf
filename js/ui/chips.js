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

// Returns { getValue, clear } — multi-select value is an array of keys.
export function multiSelect(container, options, { onChange } = {}){
  const opts = options.map(o => (typeof o === 'string' ? { key: o, label: o } : o))
  const chosen = new Set()
  if(!container) return { getValue: () => [], clear(){} }

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

  return {
    getValue: () => Array.from(chosen),
    clear(){ chosen.clear(); buttons.forEach(b => b.classList.remove('selected')) }
  }
}
