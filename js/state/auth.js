// Google sign-in and the Firestore handle. Popup first, redirect as the fallback —
// popups are unreliable in an installed PWA.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/'

const cfg = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) || {}

export const isConfigured = !!(cfg.apiKey && !String(cfg.apiKey).includes('REPLACE'))

let auth = null
let db = null
let provider = null
let authApi = null   // { signInWithPopup, … }
let storeApi = null  // { doc, setDoc, onSnapshot }

export function getDb(){ return db }
export function firestoreApi(){ return storeApi }

export async function initAuth(){
  if(!isConfigured) return false
  try{
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}firebase-app.js`),
      import(`${SDK}firebase-auth.js`),
      import(`${SDK}firebase-firestore.js`)
    ])
    authApi = authMod
    storeApi = fsMod

    const app = appMod.initializeApp(cfg)
    auth = authMod.getAuth(app)

    try{
      db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
        experimentalForceLongPolling: true
      })
    }catch(e){
      db = fsMod.initializeFirestore(app, { experimentalForceLongPolling: true })
    }

    provider = new authMod.GoogleAuthProvider()
    flushSubscribers()
    return true
  }catch(e){
    console.warn('Firebase SDK unavailable — running local-only', e)
    return false
  }
}

const pending = []

export function onAuthChange(cb){
  if(!auth){
    const entry = { cb, off: null, cancelled: false }
    pending.push(entry)
    return () => {
      entry.cancelled = true
      if(entry.off) entry.off()
    }
  }
  return authApi.onAuthStateChanged(auth, cb)
}

function flushSubscribers(){
  while(pending.length){
    const entry = pending.shift()
    if(entry.cancelled) continue
    entry.off = authApi.onAuthStateChanged(auth, entry.cb)
  }
}

export async function idToken(){
  if(!auth || !auth.currentUser) return null
  try{ return await auth.currentUser.getIdToken() }
  catch(e){ return null }
}

export function completePendingRedirect(onStatus){
  if(!auth) return
  authApi.getRedirectResult(auth).catch((e) => {
    console.error('redirect result', e)
    onStatus('Sign-in failed: ' + (e && e.code ? e.code : 'error'))
  })
}

export async function signIn(onStatus){
  if(!auth) return
  onStatus('Signing in…')
  try{
    await authApi.signInWithPopup(auth, provider)
  }catch(e){
    console.error('popup sign-in', e)
    const popupIssue = !e || !e.code || [
      'auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported',
      'auth/internal-error', 'auth/network-request-failed'
    ].includes(e.code)
    if(popupIssue){
      onStatus('Redirecting to Google…')
      try{ await authApi.signInWithRedirect(auth, provider); return }
      catch(e2){
        console.error('redirect sign-in', e2)
        onStatus('Sign-in failed: ' + (e2 && e2.code ? e2.code : 'error'))
      }
    } else {
      onStatus('Sign-in failed: ' + e.code)
    }
  }
}

export async function signOut(){
  if(!auth) return
  try{ await authApi.signOut(auth) }
  catch(e){ console.error('sign-out', e) }
}
