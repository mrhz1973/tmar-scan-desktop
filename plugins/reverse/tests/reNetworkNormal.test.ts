// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { readNetwork } from '../core/network'
import { createCentreOffset, readCentreOffset } from '../core/networkNormalMotion'
import { networkDraftOf, setCentreOffset, undoNetwork, redoNetwork, cloneData } from '../state/reNetworkDraft'
import { validateReversePart } from '../app/projectSection'
import { gridScan, sphereScan, network } from './networkMeshes'
import { ReKernel } from '../core/kernel'
import { Builder } from '../core/build'
import { build } from './reKit'

const cap=(deg:number,turn:number):[number,number,number]=>{const a=deg*Math.PI/180,t=turn*Math.PI/180;return [40*Math.cos(a),40*Math.sin(a)*Math.cos(t),40*Math.sin(a)*Math.sin(t)]}
const mesh=sphereScan(40,0.02,6)
const scan=new ScanPaths(mesh.positions,mesh.indices)
const make=()=>network(1,{1:cap(35,0),2:cap(35,120),3:cap(35,240)},[{from:1,to:2},{from:2,to:3},{from:3,to:1}],[cap(2,0)])
const part=(f:unknown)=>JSON.parse(JSON.stringify({version:3,nextFeatureId:2,nextOfKind:{},features:[f]}))

describe('split-centre displacement through coupled fitting and persistence',()=>{
  it('raises the shared centre while keeping scan topology, cells and original arrays unchanged',()=>{
    const f=make(),base=readNetwork(scan,f),anchor=base.split!.centres[0].at
    const initial=JSON.stringify(f),positions=mesh.positions.slice()
    const lifted={...f,cells:[{...f.cells[0],centre:[...anchor] as [number,number,number],centreOffset:createCentreOffset(anchor,[1,0,0],1)}]}
    const result=readNetwork(scan,lifted)
    expect(JSON.stringify(f)).toBe(initial);expect(mesh.positions).toEqual(positions)
    expect(result.outcomes.map(o=>'patches'in o?o.patches.length:o.refused)).toEqual([3])
    expect(result.split!.centres[0].at[0]-anchor[0]).toBeCloseTo(1,8)
    expect(result.traced.nodes.map(n=>n.at)).toEqual(base.traced.nodes.map(n=>n.at))
    expect(result.fit!.shared.every(s=>s.gap<1e-8)).toBe(true)
    expect(result.fit!.shared.every(s=>Number.isFinite(s.angle))).toBe(true)
    // At an extraordinary valence-three vertex, report continuity; never promise G1.
    expect(result.fit!.corners).toHaveLength(1)
    expect(result.fit!.patches).toHaveLength(3)
  })
  it('retains the sign, rejects unsupported offset versions and does not silently lift a quad',()=>{
    const f=make(),anchor=readNetwork(scan,f).split!.centres[0].at
    f.cells[0]={...f.cells[0],centre:[...anchor],centreOffset:createCentreOffset(anchor,[1,0,0],-0.5)}
    expect(readNetwork(scan,f).split!.centres[0].at[0]-anchor[0]).toBeCloseTo(-0.5,8)
    expect(()=>readCentreOffset({...f.cells[0].centreOffset,version:2})).toThrow()
    const q=network(1,{1:[5,5,0],2:[35,5,0],3:[35,35,0],4:[5,35,0]},[{from:1,to:2},{from:2,to:3},{from:3,to:4},{from:4,to:1}],[[20,20,0]])
    q.cells[0].centreOffset=createCentreOffset([20,20,0],[0,0,1],1)
    const plane=gridScan(40,40,(u,v)=>[u*40,v*40,0]);expect(()=>readNetwork(new ScanPaths(plane.positions,plane.indices),q)).toThrow('suddivisa')
  })
  it('stores numeric movement as one local Undo, prunes Redo and survives strict JSON reopening',()=>{
    const f=make(),anchor=readNetwork(scan,f).split!.centres[0].at,d=networkDraftOf(f)
    const one=setCentreOffset(d,0,createCentreOffset(anchor,[1,0,0],1))
    expect(one.history).toHaveLength(1);expect(undoNetwork(one).cells).toEqual(d.cells)
    expect(redoNetwork(undoNetwork(one)).cells).toEqual(one.cells)
    expect(setCentreOffset(undoNetwork(one),0,createCentreOffset(anchor,[1,0,0],2)).future).toEqual([])
    const copied=cloneData(one);expect(copied.cells[0].centreOffset).not.toBe(one.cells[0].centreOffset)
    const reopened=validateReversePart(part({...f,...copied})).features[0]
    expect(reopened.kind).toBe('network')
    if(reopened.kind!=='network') throw Error('wrong type')
    expect(readNetwork(scan,reopened).split!.centres[0].at[0]-anchor[0]).toBeCloseTo(1,8)
    expect(()=>validateReversePart(part({...f,cells:[{...f.cells[0],centreOffset:{version:99}}]}))).toThrow()
  })
  it('builds sewn CAD, valid STEP and an equivalent CAD result from the reopened feature',async()=>{
    const k=await ReKernel.load(),b=new Builder(k)
    b.setScan(new NominalSurface(mesh.positions,mesh.indices),mesh.positions)
    const f=make(),anchor=readNetwork(scan,f).split!.centres[0].at
    f.cells[0]={...f.cells[0],centre:[...anchor],centreOffset:createCentreOffset(anchor,[1,0,0],1)}
    const out=await build(b,[f]),r=out.results[0]
    expect(r.status).toBe('ok');expect(out.bodies[0].faces).toBe(3)
    expect(r.network!.centres[0].at[0]-anchor[0]).toBeCloseTo(1,7)
    expect(r.network!.worstGap).toBeLessThan(0.005)
    const text=b.exportStep([1]),verified=b.verifyStep([1],text)
    expect(verified.ok).toBe(true);expect(verified.problems).toEqual([])
    const reopened=validateReversePart(part(f)).features[0]
    const again=new Builder(k);again.setScan(new NominalSurface(mesh.positions,mesh.indices),mesh.positions)
    if(reopened.kind!=='network')throw Error('Unexpected reopened feature');const out2=await build(again,[reopened]);expect(out2.results[0].status).toBe('ok')
    expect(out2.results[0].network!.centres).toEqual(r.network!.centres)
    expect(again.verifyStep([1],again.exportStep([1])).ok).toBe(true)
  },120_000)
})
