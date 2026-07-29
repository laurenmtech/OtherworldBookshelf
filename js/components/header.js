// Sign-in / account controls and the sync status line.
import {
  isConfigured, initAuth, onAuthChange, completePendingRedirect, signIn, signOut
} from '../state/auth.js'
import { attachCloud, detachCloud } from '../state/persist-cloud.js'
import { reloadLocal } from '../state/store.js'

export async function mountHeader(root){
  const signinBtn = root.querySelector('#signin-btn')
  const signoutBtn = root.querySelector('#signout-btn')
  const userInfo = root.querySelector('#user-info')
  const userName = root.querySelector('#user-name')
  const userAvatar = root.querySelector('#user-avatar')
  const statusEl = root.querySelector('#sync-status')

  const setStatus = (msg) => { if(statusEl) statusEl.textContent = msg || '' }

  if(!isConfigured){
    // Local-only mode until Firebase is configured.
    if(signinBtn) signinBtn.classList.add('hidden')
    setStatus('Cloud sync not set up yet')
    return
  }

  const ready = await initAuth()
  if(!ready){
    // Configured, but the SDK couldn't be fetched (offline, blocked CDN).
    // The shelf still works; it just isn't syncing.
    if(signinBtn) signinBtn.classList.add('hidden')
    setStatus('Offline — showing local copy')
    return
  }
  if(signinBtn) signinBtn.classList.remove('hidden')

  completePendingRedirect(setStatus)

  signinBtn && signinBtn.addEventListener('click', () => signIn(setStatus))
  signoutBtn && signoutBtn.addEventListener('click', () => signOut())

  onAuthChange((user) => {
    detachCloud()

    if(!user){
      // Signed out -> local-only.
      if(signinBtn) signinBtn.classList.remove('hidden')
      if(userInfo) userInfo.classList.add('hidden')
      setStatus('')
      reloadLocal()
      return
    }

    // Signed in -> cloud mode.
    if(signinBtn) signinBtn.classList.add('hidden')
    if(userInfo) userInfo.classList.remove('hidden')
    if(userName) userName.textContent = user.displayName || user.email || 'Signed in'
    if(userAvatar){
      userAvatar.src = user.photoURL || ''
      userAvatar.style.display = user.photoURL ? '' : 'none'
    }

    // Show whatever we have locally right away so the app is usable even if the
    // cloud handshake is slow or unreachable — "Connecting" never blocks the UI.
    reloadLocal()
    attachCloud(user.uid, setStatus)
  })
}
