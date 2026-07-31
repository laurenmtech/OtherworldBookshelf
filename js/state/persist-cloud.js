// Firestore adapter: live snapshot in, debounced saves out.
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
  clearTimers()
  if(unsub){ unsub(); unsub = null }
  setCloudSave(null)
}

export function attachCloud(uid, onStatus){
  detachCloud()
  const { doc, setDoc, onSnapshot } = firestoreApi() || {}
  if(!doc) return // SDK never loaded; local-only
  const ref = doc(getDb(), 'users', uid)

  let seeded = false
  let synced = false
  let writesEnabled = false

  function write(state){
    setDoc(ref, plain(state))
      .then(() => onStatus('Synced'))
      .catch(err => { console.error('cloud save', err); onStatus('Save failed') })
  }

  setCloudSave((state) => {
    if(!writesEnabled) return
    write(state)
  })

  onStatus('Connecting…')

  unsub = onSnapshot(ref, { includeMetadataChanges: true },
    (snap) => {
      const fromServer = !snap.metadata.fromCache
      const hasCloudData = snap.exists() && !isEmptyState(snap.data())

      if(hasCloudData) applyRemote(snap.data())

      if(!fromServer) return

      writesEnabled = true
      clearTimers()

      if(hasCloudData){
        seeded = true // cloud already holds data; never seed over it
        synced = true
        onStatus('Synced')
        return
      }

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
