// SPDX-License-Identifier: AGPL-3.0-only
// Only participating stores are gated. State mutation is synchronous; observers
// are released after ALL participating stores/history have their committed state.
import type { StateCreator } from 'zustand'
let batch = 0
let notifying = false
const pending = new Map<object, () => void>()
const failures: unknown[] = []
export const takeAtomicNotificationErrors = () => failures.splice(0)
export function atomicNotifications<T>(job: () => T): T {
  if (notifying) throw new Error('Reentrant mutation during atomic publication is forbidden.')
  const outer=batch++===0, saved=outer?null:new Map(pending)
  try {
    const result=job()
    if(result && typeof (result as {then?:unknown}).then==='function') throw new Error('Atomic publication must be synchronous.')
    return result
  } catch(error) {
    pending.clear(); if(saved) for(const [k,v] of saved) pending.set(k,v)
    throw error
  } finally {
    batch--
    if(outer && pending.size) {
      const ready=[...pending.values()];pending.clear();notifying=true
      try { for(const notify of ready) { try{notify()}catch(error){failures.push(error)} } }
      finally {notifying=false}
    }
  }
}
/** Runtime and captured action closures use the SAME guarded setter. */
export function withAtomicNotifications<T>(initialise: StateCreator<T,[],[]>): StateCreator<T,[],[]> {
  return (set,get,api)=>{
    const originalSubscribe=api.subscribe
    const guarded = ((partial:T|Partial<T>|((state:T)=>T|Partial<T>),replace?:boolean)=>{
      if(notifying) throw new Error('Reentrant mutation during committed notification is forbidden.')
      if(replace) set(partial as T,true)
      else set(partial,false)
    }) as typeof set
    api.setState=guarded
    api.subscribe=(listener)=>{
      const token={},read=()=>get();let live=true
      const off=originalSubscribe((state,previous)=>{
        if(!batch) {listener(state,previous);return}
        if(!pending.has(token)) pending.set(token,()=>{if(live)listener(read(),previous)})
      })
      return ()=>{live=false;pending.delete(token);off()}
    }
    return initialise(guarded,get,api)
  }
}
