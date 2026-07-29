// localStorage adapter. The shelf when signed out, and the instant-render copy
// when signed in.
import { migrate, toStorage, emptyState } from './migrate.js'

const LS_KEY = 'otherworld_reads_v1'

export function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY)
    if(!raw) return emptyState()
    return migrate(JSON.parse(raw))
  }catch(e){
    console.error('loadLocal', e)
    return emptyState()
  }
}

export function saveLocal(state){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(toStorage(state)))
  }catch(e){
    console.error('saveLocal', e)
  }
}
