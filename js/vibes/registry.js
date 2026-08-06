// The five vibes: id, name, blurb, fonts, status-bar colour.
export const VIBES = [
  {
    id: 'otherworld',
    name: 'Otherworld',
    blurb: 'Quiet hours and strange moons.',
    theme: '#0b0710',
    fonts: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Space+Grotesk:wght@300;600&display=optional'
  },
  {
    id: 'cottage',
    name: 'Cottage',
    blurb: 'Cream, sage and terracotta. Reads like a warm kitchen.',
    theme: '#fbf7f0',
    fonts: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=Nunito:wght@300;600&display=optional'
  },
  {
    id: 'celestial',
    name: 'Celestial',
    blurb: 'Deep indigo, periwinkle and starlight.',
    theme: '#070a1a',
    fonts: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;700&family=Inter:wght@300;600&display=optional'
  },
  {
    id: 'dark-academia',
    name: 'Dark Academia',
    blurb: 'Lamplit wood, antique gold and oxblood.',
    theme: '#15100c',
    fonts: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=EB+Garamond:wght@400;600&display=optional'
  },
  {
    id: 'seaglass',
    name: 'Seaglass',
    blurb: 'Pale tide, sea green and wet sand.',
    theme: '#f5fbf9',
    fonts: 'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;700&family=Karla:wght@300;600&display=optional'
  }
]

export const DEFAULT_VIBE = 'otherworld'

export const getVibe = id => VIBES.find(v => v.id === id) || null