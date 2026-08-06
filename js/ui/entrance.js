// The entrance animation is for rows arriving, not for rows that were already
// sitting there.
//
// Every list in the app rebuilds itself from scratch on every store
// notification, and plenty of those notifications aren't news: a Firestore
// snapshot landing, a Libby answer filling in an availability line, a chip
// toggled somewhere else on the page. Replaying the fade on every row each time
// is what makes the page look like it's flickering.
//
// Give the guard the keys you're about to render and it tells you whether the
// list has actually changed. The rest is CSS: `.no-entrance .list-actions`.
//
// A book key is a title and an author, so it can hold spaces and punctuation.
// NUL is the one thing it can't — and with a separator a key could contain, two
// different lists could join to the same string and a genuinely new row would
// arrive without its entrance.
const SEP = '\u0000'

export function entranceGuard(){
  let last = null
  return function isNews(keys){
    const now = keys.join(SEP)
    if(now === last) return false
    last = now
    return true
  }
}
