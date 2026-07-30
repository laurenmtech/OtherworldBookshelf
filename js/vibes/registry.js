// The vibe registry: id, display name, the webfonts it needs, and the colour
// the installed PWA paints its status bar.
//
// Adding a sixth vibe is a file in styles/vibes/, one entry here, and one line
// in the <link> list in index.html. Nothing else knows vibes exist —
// components reference tokens and never ask which one is active.
//
// KEEP IN SYNC with the inline boot script in index.html, which needs the same
// fonts and theme colours before any module can load. tests assert they match,
// so drift is caught rather than discovered.

export const VIBES = [
  {
    id: 'otherworld',
    name: 'Otherworld',
    blurb: 'Quiet hours and strange moons.',
    theme: '#0b0710',
    fonts: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Space+Grotesk:wght@300;600&display=swap'
  },
  {
    id: 'cottage',
    name: 'Cottage',
    blurb: 'Cream, sage and terracotta. Reads like a warm kitchen.',
    theme: '#fbf7f0',
    fonts: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=Nunito:wght@300;600&display=swap'
  },
  {
    id: 'celestial',
    name: 'Celestial',
    blurb: 'Deep indigo, periwinkle and starlight.',
    theme: '#070a1a',
    fonts: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;700&family=Inter:wght@300;600&display=swap'
  },
  {
    id: 'dark-academia',
    name: 'Dark Academia',
    blurb: 'Lamplit wood, antique gold and oxblood.',
    theme: '#15100c',
    fonts: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=EB+Garamond:wght@400;600&display=swap'
  },
  {
    id: 'seaglass',
    name: 'Seaglass',
    blurb: 'Pale tide, sea green and wet sand.',
    theme: '#f5fbf9',
    fonts: 'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;700&family=Karla:wght@300;600&display=swap'
  }
]

export const DEFAULT_VIBE = 'otherworld'

export const getVibe = id => VIBES.find(v => v.id === id) || null
export const isVibe = id => !!getVibe(id)
