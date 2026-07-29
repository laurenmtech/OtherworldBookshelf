// The Reading route: everything touched daily, and nothing else.
//
// Current Reads and the TBR pile. Coming Soon (Phase 8) mounts here too when it
// exists; the archive and the libraries deliberately do not — they moved to the
// Finished tab and the settings sheet respectively, which is the whole point of
// this phase.
import { mountCurrentReads } from '../components/current-reads.js'
import { mountTbrPile } from '../components/tbr-pile.js'

export function mountReading(root, { finishModal, bookModal }){
  if(!root) return
  mountCurrentReads(root.querySelector('.current-panel'), { finishModal })
  mountTbrPile(root.querySelector('.wishlist-panel'), { bookModal })
}
