// Firestore adapter: live snapshot in, saves out, first-login seeding.
// Ported from sync.js with its behaviour intact — the seeding rules here are
// subtle and were arrived at by fixing real bugs.
// Firestore functions come from auth.js, which loads the SDK dynamically — see
// the note there about keeping the CDN out of the app's critical path.
import { getDb, firestoreApi } from './auth.js'
import { applyRemote, setCloudSave } from './store.js'
import { loadLocal } from './persist-local.js'
import { toStorage, isEmptyState } from './migrate.js'

let unsub = null
let timers = []

function plain(state){ return JSON.parse(JSON.stringify(toStorage(state))) }

function clearTimers(){ timers.forEach(clearTimeout); timers = [] }
function later(ms, fn){ timers.push(setTimeout(fn, ms)) }

export function detachCloud(){
  // Timers outlive their attachment otherwise, and a stale one firing after a
  // later sign-in would overwrite a good status with a bad one.
  clearTimers()
  if(unsub){ unsub(); unsub = null }
  setCloudSave(null)
}

// Attach the live listener for a signed-in user. Returns nothing; call
// detachCloud() on sign-out or before re-attaching.
export function attachCloud(uid, onStatus){
  detachCloud()
  const { doc, setDoc, onSnapshot } = firestoreApi() || {}
  if(!doc) return // SDK never loaded; local-only
  const ref = doc(getDb(), 'users', uid)

  let seeded = false
  let synced = false
  // Saves are BLOCKED until the server has told us what's already up there.
  //
  // setDoc replaces the whole document. Sign in on a phone whose local copy is
  // empty — a fresh install, or a home-screen app that was removed and re-added
  // — and any edit made during those first seconds would write that empty shelf
  // over the real one. The window is short but it's the exact window in which
  // someone stares at an empty app and starts re-adding their books.
  let writesEnabled = false

  function write(state){
    setDoc(ref, plain(state))
      .then(() => onStatus('Synced'))
      .catch(err => { console.error('cloud save', err); onStatus('Save failed') })
  }

  setCloudSave((state) => {
    // Dropped rather than queued, on purpose: whatever the server has is about
    // to arrive and win anyway, and the change is already safe in localStorage.
    if(!writesEnabled) return
    write(state)
  })

  onStatus('Connecting…')

  // Attach the live listener immediately (no blocking getDoc first) so cloud
  // data shows as soon as the first snapshot arrives. includeMetadataChanges
  // lets us tell a cached snapshot from a server-confirmed one.
  unsub = onSnapshot(ref, { includeMetadataChanges: true },
    (snap) => {
      const fromServer = !snap.metadata.fromCache
      const hasCloudData = snap.exists() && !isEmptyState(snap.data())

      // Show whatever we have the moment we have it, cache or server — seeing
      // your shelf shouldn't wait on a round trip.
      if(hasCloudData) applyRemote(snap.data())

      // But "Synced" requires the SERVER to have said so. This used to accept a
      // cached snapshot as proof, which meant the SDK handing back a write from
      // its own local cache read as a successful sync. It reported Synced for
      // months against a project that had no Firestore database at all. A status
      // that can't tell the difference between "saved" and "not saved" is worse
      // than no status.
      if(!fromServer) return

      writesEnabled = true
      clearTimers()

      if(hasCloudData){
        seeded = true // cloud already holds data; never seed over it
        synced = true
        onStatus('Synced')
        return
      }

      // Server confirms there's nothing up there — safe to seed from local.
      if(!seeded){
        seeded = true
        const local = loadLocal()
        if(!isEmptyState(local)){
          onStatus('Uploading…')
          setDoc(ref, plain(local))
            .then(() => { synced = true; onStatus('Synced') })
            .catch(err => { console.error('seed', err); onStatus('Save failed') })
        } else {
          synced = true
          onStatus('Synced') // genuinely empty on both sides
        }
      }
    },
    (err) => {
      console.error('snapshot', err)
      clearTimers()
      onStatus('Sync error: ' + (err && err.code ? err.code : 'error'))
    }
  )

  // Say something true while it works. A first connection on a cold install
  // over cellular, with long-polling forced, routinely takes longer than the
  // six seconds this used to allow before declaring the app offline.
  later(8000, () => {
    if(synced) return
    onStatus(navigator.onLine === false
      ? 'Offline — showing local copy'
      : 'Still connecting…')
  })
  later(25000, () => {
    if(synced) return
    onStatus('Can’t reach the cloud — showing local copy')
  })
}
