// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { smoothRegion } from '../../mesh-tools/core/smoothRegion'
import { smoothMesh } from '../../mesh-tools/core/smooth'

describe('regional Smooth never silently becomes global', () => {
  it('refuses both missing and explicitly empty markings', () => {
    expect(() => smoothRegion('marked', undefined, () => new Uint32Array())).toThrow(/Nothing is marked/)
    expect(() => smoothRegion('marked', new Uint32Array(), () => new Uint32Array([1]))).toThrow(/Nothing is marked/)
    expect(() => smoothRegion('marked', null, () => new Uint32Array([1]))).toThrow(/whole-part/)
  })
  it('freezes and deduplicates the selection at invocation', () => {
    const ids = new Uint32Array([1, 3, 3, 5]), read = vi.fn(() => ids)
    const result = smoothRegion('marked', undefined, read)!
    ids.fill(0)
    expect([...result]).toEqual([1, 3, 5]); expect(read).toHaveBeenCalledTimes(1)
  })
  it('does not consult a later UI mask when an explicit snapshot was supplied', () => {
    const read = vi.fn(() => new Uint32Array([99]))
    expect([...smoothRegion('marked', new Uint32Array([1, 4]), read)!]).toEqual([1, 4])
    expect(read).not.toHaveBeenCalled()
  })
  it('requires explicit whole-part intent to return the all-surface sentinel', () => {
    expect(smoothRegion('all', null, () => new Uint32Array([1]))).toBeNull()
    expect(smoothRegion('all', undefined, () => new Uint32Array())).toBeNull()
  })
  const fixture = () => {
    const p:number[] = [],i:number[] = [],n=16
    for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)p.push(x*.5,y*.5,.05*Math.sin(x*1.5)*Math.cos(y*1.7))
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x;i.push(a,a+1,a+n+2,a,a+n+2,a+n+1)}
    return {positions:Float32Array.from(p),indices:Uint32Array.from(i),vertexCount:(n+1)**2}
  }
  it('refuses obsolete vertex IDs before moving anything', () => {
    const f=fixture(),original=f.positions.slice()
    expect(()=>smoothMesh(f.positions,f.indices,f.vertexCount,{size:1,limit:.1,keepEdges:true,region:new Uint32Array([f.vertexCount])})).toThrow(/no longer matches/)
    expect(f.positions).toEqual(original)
  })
  it('keeps every unselected coordinate bit-identical through two regional passes', () => {
    const f=fixture(),selected=new Uint32Array(Array.from({length:f.vertexCount},(_,v)=>v).filter(v=>v%17>=5&&v%17<=11&&Math.floor(v/17)>=5&&Math.floor(v/17)<=11))
    const settings={size:1,limit:.1,keepEdges:true,strength:.5,region:selected}
    const a=smoothMesh(f.positions,f.indices,f.vertexCount,settings)
    const b=smoothMesh(a.positions,a.indices,a.positions.length/3,settings),set=new Set(selected)
    expect(a.positions.some((x,i)=>x!==f.positions[i])).toBe(true)
    expect(b.positions.some((x,i)=>x!==a.positions[i])).toBe(true)
    for(let i=0;i<b.positions.length;i++)if(!set.has(Math.floor(i/3)))expect(b.positions[i]).toBe(f.positions[i])
  })
})
