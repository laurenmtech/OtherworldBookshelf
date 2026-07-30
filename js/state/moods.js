// The vocabulary: how a book felt, and what it felt like.
//
// This used to live in finish-modal.js, which was fine while that modal was the
// only thing that asked. Phase 4's "set it down" asks the same question, the
// Finished filters render the same words, and the mood picker is now shared —
// so the words moved to a module none of them owns, rather than three files
// importing one modal for its constants.

export const FEELINGS = [
  { key: 'loved', label: '💛 Loved' },
  { key: 'liked', label: 'Liked' },
  { key: 'not-for-me', label: 'Not for me' }
]

// Not a feeling anyone picks — it's the mark a book carries when it was set
// down for good, and it earns a label here so the Finished filter chip derived
// from the data reads as words rather than as a raw key.
export const SET_DOWN = 'set-down'
export const SET_DOWN_LABEL = 'Set down'

// Vibes, in three groups. The original ten were all fantasy-shaped, which left
// horror, science fiction and anything read to learn something with no words
// that fitted. Every one of those ten is still here — extending the list can't
// orphan a vibe already saved on a book.
export const MOOD_GROUPS = [
  { label: 'Atmosphere', moods: ['Cozy', 'Dark', 'Creepy', 'Dread', 'Bleak', 'Whimsical', 'Hopeful'] },
  { label: 'Story', moods: ['Epic', 'Twisty', 'Slow-burn', 'Fast-paced', 'Tense', 'Funny', 'Devastating', 'Romantic', 'Comfort-read'] },
  { label: 'Mind', moods: ['Mind-expanding', 'Mind-bending', 'Practical', 'Dense', 'Eye-opening'] }
]

// Flat, in group order — the canonical ordering the Finished filters sort by.
export const MOODS = MOOD_GROUPS.flatMap(g => g.moods)

export const feelingLabel = (k) => {
  if(k === SET_DOWN) return SET_DOWN_LABEL
  return (FEELINGS.find(f => f.key === k) || {}).label
}

// Vibes you typed yourself are not stored in their own list: they're read back
// off the books that carry them. That means no schema change, no second place
// for the vocabulary to drift out of sync, and a list that stays honest — a
// word you used once and then removed stops being offered.
export function customMoods(finished){
  const known = new Set(MOODS)
  const seen = new Set()
  for(const item of finished || []){
    for(const m of item.moods || []) if(!known.has(m)) seen.add(m)
  }
  return Array.from(seen).sort()
}
