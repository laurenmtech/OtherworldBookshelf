// The vocabulary: feelings, the grouped vibe words, and "set down".
export const FEELINGS = [
  { key: 'loved', label: '💛 Loved' },
  { key: 'liked', label: 'Liked' },
  { key: 'not-for-me', label: 'Not for me' }
]

export const SET_DOWN = 'set-down'
export const SET_DOWN_LABEL = 'Set down'

export const MOOD_GROUPS = [
  { label: 'Atmosphere', moods: ['Cozy', 'Dark', 'Creepy', 'Dread', 'Bleak', 'Whimsical', 'Hopeful'] },
  { label: 'Story', moods: ['Epic', 'Twisty', 'Slow-burn', 'Fast-paced', 'Tense', 'Funny', 'Devastating', 'Romantic', 'Comfort-read'] },
  { label: 'Mind', moods: ['Mind-expanding', 'Mind-bending', 'Practical', 'Dense', 'Eye-opening'] }
]

export const MOODS = MOOD_GROUPS.flatMap(g => g.moods)

export const feelingLabel = (k) => {
  if(k === SET_DOWN) return SET_DOWN_LABEL
  return (FEELINGS.find(f => f.key === k) || {}).label
}

export function customMoods(finished){
  const known = new Set(MOODS)
  const seen = new Set()
  for(const item of finished || []){
    for(const m of item.moods || []) if(!known.has(m)) seen.add(m)
  }
  return Array.from(seen).sort()
}
