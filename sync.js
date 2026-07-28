// Cloud sync + Google auth via Firebase. Loaded as a module after app.js,
// so the window.__* bridge functions it calls already exist.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const cfg = window.FIREBASE_CONFIG || {};
const configured = cfg.apiKey && !String(cfg.apiKey).includes('REPLACE');

// UI refs
const signinBtn = document.getElementById('signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userAvatar = document.getElementById('user-avatar');
const syncStatus = document.getElementById('sync-status');

function setStatus(msg){ if(syncStatus) syncStatus.textContent = msg || ''; }

function isEmptyState(s){
  if(!s) return true;
  return !s.current
    && (!s.wishlist || !s.wishlist.length)
    && (!s.finished || !s.finished.length)
    && (!s.library || !s.library.length);
}

if(!configured){
  // Local-only mode until Firebase is configured.
  if(signinBtn) signinBtn.classList.add('hidden');
  setStatus('Cloud sync not set up yet');
} else {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  let db;
  // experimentalForceLongPolling: some environments reach Firestore over plain
  // HTTPS (one-shot requests return 200) but can't hold the streaming WebChannel
  // session, leaving the client stuck offline. Forcing long-polling uses simple
  // request/response polling instead, which those setups pass through. Slightly
  // less efficient, but this is a tiny personal app and reliability wins.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalForceLongPolling: true
    });
  } catch(e){
    // Fall back to default (memory) cache if persistence can't initialize.
    db = initializeFirestore(app, { experimentalForceLongPolling: true });
  }
  const provider = new GoogleAuthProvider();
  let unsub = null;

  if(signinBtn) signinBtn.classList.remove('hidden');

  // Complete any pending redirect-based sign-in (returns here after the Google page).
  getRedirectResult(auth).catch((e)=>{
    console.error('redirect result', e);
    setStatus('Sign-in failed: ' + (e && e.code ? e.code : 'error'));
  });

  signinBtn && signinBtn.addEventListener('click', async ()=>{
    setStatus('Signing in…');
    try {
      await signInWithPopup(auth, provider);
    } catch(e){
      console.error('popup sign-in', e);
      // Popups are unreliable on phones / installed PWAs — fall back to a full-page redirect.
      const popupIssue = !e || !e.code || [
        'auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request',
        'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported',
        'auth/internal-error', 'auth/network-request-failed'
      ].includes(e.code);
      if(popupIssue){
        setStatus('Redirecting to Google…');
        try { await signInWithRedirect(auth, provider); return; }
        catch(e2){ console.error('redirect sign-in', e2); setStatus('Sign-in failed: ' + (e2 && e2.code ? e2.code : 'error')); }
      } else {
        setStatus('Sign-in failed: ' + e.code);
      }
    }
  });
  signoutBtn && signoutBtn.addEventListener('click', async ()=>{
    try { await signOut(auth); } catch(e){ console.error('sign-out', e); }
  });

  onAuthStateChanged(auth, async (user)=>{
    if(unsub){ unsub(); unsub = null; }

    if(!user){
      // Signed out -> local-only.
      window.__setCloudMode(false);
      window.__cloudSave = null;
      if(signinBtn) signinBtn.classList.remove('hidden');
      if(userInfo) userInfo.classList.add('hidden');
      setStatus('');
      if(window.__loadLocal) window.__loadLocal();
      return;
    }

    // Signed in -> cloud mode.
    if(signinBtn) signinBtn.classList.add('hidden');
    if(userInfo) userInfo.classList.remove('hidden');
    if(userName) userName.textContent = user.displayName || user.email || 'Signed in';
    if(userAvatar){
      userAvatar.src = user.photoURL || '';
      userAvatar.style.display = user.photoURL ? '' : 'none';
    }

    const ref = doc(db, 'users', user.uid);
    // Persist saves to the cloud (JSON round-trip strips any undefined values).
    window.__cloudSave = (s)=>{
      setDoc(ref, JSON.parse(JSON.stringify(s)))
        .then(()=> setStatus('Synced'))
        .catch(err=>{ console.error('cloud save', err); setStatus('Save failed'); });
    };
    window.__setCloudMode(true);
    setStatus('Connecting…');

    // Show whatever we have locally right away so the app is usable even if the
    // cloud handshake is slow or unreachable — "Connecting" never blocks the UI.
    if(window.__loadLocal) window.__loadLocal();

    // Attach the live listener immediately (no blocking getDoc first) so cloud
    // data shows as soon as the first snapshot arrives. includeMetadataChanges
    // lets us tell a cached snapshot from a server-confirmed one.
    let seeded = false;
    let synced = false;
    unsub = onSnapshot(ref, { includeMetadataChanges: true },
      (snap)=>{
        const fromServer = !snap.metadata.fromCache;
        const hasCloudData = snap.exists() && !isEmptyState(snap.data());
        console.debug('[sync] snapshot', { fromServer, exists: snap.exists(), hasCloudData });

        // Any snapshot with data (cache or server) is real data — show it and
        // call it synced. Waiting for a server-only confirmation can hang, since
        // Firestore may not re-fire when the cached doc already matches.
        if(hasCloudData){
          window.__applyRemoteState(snap.data());
          seeded = true; // cloud already holds data; never seed over it
          synced = true;
          setStatus('Synced');
          return;
        }

        // No cloud data. Only seed from local once the SERVER confirms empty, so
        // we don't overwrite another device's data based on a stale local cache.
        if(fromServer && !seeded){
          seeded = true;
          const local = window.__getLocalState ? window.__getLocalState() : null;
          if(local && !isEmptyState(local)){
            setStatus('Uploading…');
            setDoc(ref, JSON.parse(JSON.stringify(local)))
              .then(()=>{ synced = true; setStatus('Synced'); })
              .catch(err=>{ console.error('seed', err); setStatus('Save failed'); });
          } else {
            synced = true;
            setStatus('Synced'); // genuinely empty on both sides
          }
        }
      },
      (err)=>{ console.error('snapshot', err); setStatus('Sync error: ' + (err && err.code ? err.code : 'error')); }
    );

    // Safety net: if the server never answers (blocked WebChannel, offline),
    // stop pretending to connect — the local copy above is already showing.
    setTimeout(()=>{ if(!synced) setStatus('Offline — showing local copy'); }, 6000);
  });
}
