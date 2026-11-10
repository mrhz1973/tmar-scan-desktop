// SPDX-License-Identifier: AGPL-3.0-only
import { readAdaptiveTrimRecipe, type AdaptiveTrimRecipe } from './adaptiveTrimRecipe'
import type { Point } from './brep'

/** V8 stores each lock's position; v7 remains independently readable. */
export type AdaptiveLockedRecipe = Omit<AdaptiveTrimRecipe, 'version'> & {
  version: 8
  lockedValues: { index: number; point: Point }[]
}

export function readAdaptiveLockedRecipe(input: unknown): AdaptiveLockedRecipe {
  const fail=():never=>{throw new Error('Ricetta Edit Surface v8 non supportata o incompleta.')}
  if(!input || typeof input!=='object' || Array.isArray(input)) return fail()
  const o=input as Record<string,unknown>, keys=Reflect.ownKeys(o)
  if(Object.getPrototypeOf(o)!==Object.prototype && Object.getPrototypeOf(o)!==null) return fail()
  if(!keys.includes('lockedValues') || keys.some(k=>typeof k!=='string') ||
    keys.some(k=>{const d=Object.getOwnPropertyDescriptor(o,k);return !d || !('value' in d) || !d.enumerable})) return fail()
  if(o.version!==8 || !Array.isArray(o.lockedValues) || o.lockedValues.length>1600 || Reflect.ownKeys(o.lockedValues).length!==o.lockedValues.length+1) return fail()
  const values=o.lockedValues
  if(Array.from({length:values.length},(_,i)=> {
    const d=Object.getOwnPropertyDescriptor(values,String(i))
    const entry=d && 'value' in d ? d.value : undefined
    if(!d || !('value' in d) || !d.enumerable || !entry || typeof entry!=='object' || Array.isArray(entry)) return true
    const e=entry as Record<string,unknown>, ed=Object.getOwnPropertyDescriptors(e)
    if(Reflect.ownKeys(e).length!==2 || !ed.index || !ed.point || !('value' in ed.index) || !('value' in ed.point) ||
      !ed.index.enumerable || !ed.point.enumerable || !Number.isSafeInteger(e.index) || Object.is(e.index,-0) || (e.index as number)<0 ||
      !Array.isArray(e.point) || e.point.length!==3 || Reflect.ownKeys(e.point).length!==4) return true
    return [0,1,2].some(j=>{const p=Object.getOwnPropertyDescriptor(e.point!,String(j));return !p || !('value' in p) || !p.enumerable || typeof p.value!=='number' || !Number.isFinite(p.value)})
  }).some(Boolean)) return fail()
  try {
    const snapshot=structuredClone(o), {lockedValues,...common}=snapshot
    const base=readAdaptiveTrimRecipe({...common,version:7})
    const positions=lockedValues as {index:number;point:Point}[]
    if(positions.length!==base.lockedPoles.length || new Set(positions.map(p=>p.index)).size!==positions.length ||
      positions.some(p=>!base.lockedPoles.includes(p.index))) return fail()
    return {...base,version:8,lockedValues:positions}
  } catch {return fail()}
}
