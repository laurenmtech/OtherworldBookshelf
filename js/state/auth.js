// Google sign-in and the Firestore handle. Logic moved intact from the old
// sync.js — the auth fallbacks and Firestore options here are load-bearing.
//
// The Firebase SDK is loaded with a DYNAMIC import, on purpose: a static
// `import` at the top of this file would put a third-party CDN in the critical
// path of the whole module graph, so an unreachable gstatic would leave the app
// blank instead of merely un-synced. The shelf must render with no network.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5/'

const cfg = (typeof window !== 'undefined' && window.FIREBASE_CONFIG) || {}

// Until a real Firebase config is pasted in, the app runs local-only.
export const isConfigured = !!(cfg.apiKey && !String(cfg.apiKey).includes('REPLACE'))

let auth = null
let db = null
let provider = null
let authApi = null   // { signInWithPopup, … }
let storeApi = null  // { doc, setDoc, onSnapshot }

export function getDb(){ return db }
export function firestoreApi(){ return storeApi }

// Resolves true once Firebase is ready, false if it isn't configured or the
// SDK can't be fetched. Never throws.
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

    // experimentalForceLongPolling: some environments reach Firestore over plain
    // HTTPS (one-shot requests return 200) but can't hold the streaming WebChannel
    // session, leaving the client stuck offline. Forcing long-polling uses simple
    // request/response polling instead, which those setups pass through. Slightly
    // less efficient, but this is a tiny personal app and reliability wins.
    try{
      db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
        experimentalForceLongPolling: true
      })
    }catch(e){
      // Fall back to default (memory) cache if persistence can't initialize.
      db = fsMod.initializeFirestore(app, { experimentalForceLongPolling: true })
    }

    provider = new authMod.GoogleAuthProvider()
    return true
  }catch(e){
    console.warn('Firebase SDK unavailable — running local-only', e)
    return false
  }
}

export function onAuthChange(cb){
  if(!auth) return
  authApi.onAuthStateChanged(auth, cb)
}

// Complete any pending redirect-based sign-in (returns here after the Google page).
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
    // Popups are unreliable on phones / installed PWAs — fall back to a full-page redirect.
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
