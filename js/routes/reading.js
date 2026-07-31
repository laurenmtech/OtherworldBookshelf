// The Reading route: current reads + the TBR pile.
import { mountCurrentReads } from '../components/current-reads.js'
import { mountTbrPile } from '../components/tbr-pile.js'

export function mountReading(root, { finishModal, bookModal, setDownModal }){
  if(!root) return
  mountCurrentReads(root.querySelector('.current-panel'), { finishModal, bookModal, setDownModal })
  mountTbrPile(root.querySelector('.wishlist-panel'), { bookModal })
}
