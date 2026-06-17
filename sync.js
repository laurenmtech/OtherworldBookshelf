// Cloud sync + Google auth via Firebase. Loaded as a module after app.js,
// so the window.__* bridge functions it calls already exist.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, getDoc, setDoc, onSnapshot
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
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
    });
  } catch(e){
    // Fall back to default (memory) cache if persistence can't initialize.
    db = initializeFirestore(app, {});
  }
  const provider = new GoogleAuthProvider();
  let unsub = null;

  if(signinBtn) signinBtn.classList.remove('hidden');

  signinBtn && signinBtn.addEventListener('click', async ()=>{
    setStatus('Signing in…');
    try { await signInWithPopup(auth, provider); }
    catch(e){ console.error('sign-in', e); setStatus('Sign-in failed'); }
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

    // First login: if the cloud doc is empty, seed it with this device's local data.
    try {
      const snap = await getDoc(ref);
      if(!snap.exists() || isEmptyState(snap.data())){
        const local = window.__getLocalState ? window.__getLocalState() : null;
        if(local && !isEmptyState(local)){
          await setDoc(ref, JSON.parse(JSON.stringify(local)));
        }
      }
    } catch(e){ console.error('initial sync', e); }

    // Live updates from any device.
    unsub = onSnapshot(ref,
      (snap)=>{ if(snap.exists()) window.__applyRemoteState(snap.data()); setStatus('Synced'); },
      (err)=>{ console.error('snapshot', err); setStatus('Sync error'); }
    );
  });
}
