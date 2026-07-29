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

function plain(state){ return JSON.parse(JSON.stringify(toStorage(state))) }

export function detachCloud(){
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

  // Persist saves to the cloud (JSON round-trip strips any undefined values).
  setCloudSave((state) => {
    setDoc(ref, plain(state))
      .then(() => onStatus('Synced'))
      .catch(err => { console.error('cloud save', err); onStatus('Save failed') })
  })

  onStatus('Connecting…')

  // Attach the live listener immediately (no blocking getDoc first) so cloud
  // data shows as soon as the first snapshot arrives. includeMetadataChanges
  // lets us tell a cached snapshot from a server-confirmed one.
  let seeded = false
  let synced = false
  unsub = onSnapshot(ref, { includeMetadataChanges: true },
    (snap) => {
      const fromServer = !snap.metadata.fromCache
      const hasCloudData = snap.exists() && !isEmptyState(snap.data())

      // Any snapshot with data (cache or server) is real data — show it and
      // call it synced. Waiting for a server-only confirmation can hang, since
      // Firestore may not re-fire when the cached doc already matches.
      if(hasCloudData){
        applyRemote(snap.data())
        seeded = true // cloud already holds data; never seed over it
        synced = true
        onStatus('Synced')
        return
      }

      // No cloud data. Only seed from local once the SERVER confirms empty, so
      // we don't overwrite another device's data based on a stale local cache.
      if(fromServer && !seeded){
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
      onStatus('Sync error: ' + (err && err.code ? err.code : 'error'))
    }
  )

  // Safety net: if the server never answers (blocked WebChannel, offline),
  // stop pretending to connect — the local copy is already showing.
  setTimeout(() => { if(!synced) onStatus('Offline — showing local copy') }, 6000)
}
