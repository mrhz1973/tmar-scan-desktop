// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Net } from '../brep'
import { SurfaceHistory, type EditFrame } from '../surfaceHistory'
import { refineClampedNet, type KnotInsertion } from '../refineClampedNet'

function frame(z = 0): EditFrame {
  const net: Net = { nu: 2, nv: 2, du: 1, dv: 1,
    poles: [[0, 0, z], [0, 1, 0], [1, 0, 0], [1, 1, 0]],
    weights: [1, 1, 1, 1], rational: [0, 0], ku: [0, 1], kv: [0, 1], mu: [2, 2], mv: [2, 2] }
  return { net, locks: [], continuity: 'G1', freeBoundary: false }
}

describe('surface geometry and protection history', () => {
  it('records an exact adaptive refinement and requires fresh identities across bases',()=>{
    const h=new SurfaceHistory(),initial=frame(1),base=frame().net,additions:KnotInsertion[]=[{axis:'U',value:.5,count:1}]
    const first={face:2,refinements:[] as KnotInsertion[],trimPolicy:'circular-fine-v1' as const,generation:1,trimLocks:[] as number[],hiddenPoles:[] as number[]}
    const second={...first,refinements:additions,generation:2}
    const prep={face:2,refinements:[] as KnotInsertion[],originalNet:base,trimLocks:[] as number[],hiddenPoles:[] as number[],adaptiveSelection:first}
    h.commit({...initial,preparation:prep,lockSnapshots:[]})
    const next={...initial,net:refineClampedNet(initial.net,additions),lockSnapshots:[],
      preparation:{...prep,refinements:additions,originalNet:refineClampedNet(base,additions),adaptiveSelection:second}}
    expect(()=>h.commit(next)).toThrow(/rimappare/)
    const bad=structuredClone(next);bad.net.poles[0][2]+=.1
    expect(()=>h.commitAdaptiveRefinement(bad,additions)).toThrow(/coerente/)
    const protectedMove=structuredClone(next);protectedMove.preparation.trimLocks=[0];protectedMove.preparation.adaptiveSelection.trimLocks=[0]
    expect(()=>h.commitAdaptiveRefinement(protectedMove,additions)).toThrow(/Protezione/)
    h.commitAdaptiveRefinement(next,additions)
    h.commit({...next,locks:[0],lockSnapshots:undefined})
    expect(h.step(-1)?.locks).toEqual([])
    expect(h.peek(-1)?.net).toEqual(initial.net)
    expect(()=>h.step(-1)).toThrow(/Riattiva/)
    expect(()=>h.stepAdaptive(-1,{...first,generation:2})).toThrow(/coerente/)
    expect(h.stepAdaptive(-1,{...first,generation:3}).net).toEqual(initial.net)
    expect(h.stepAdaptive(1,{...second,generation:4}).net).toEqual(next.net)
    expect(h.current?.lockSnapshots).toEqual([])
    const currentToken=h.current?.preparation?.adaptiveSelection
    expect(h.step(1)?.locks).toEqual([0])
    expect(h.current?.preparation?.adaptiveSelection).toBe(currentToken)
  })
  it('retains adaptive lock positions through undo, unlock, relock and redo', () => {
    const h=new SurfaceHistory()
    h.commit({...frame(),lockSnapshots:[]})
    h.commit(frame(1))
    h.commit({...frame(1),locks:[0]})
    expect(h.current?.lockSnapshots).toEqual([{index:0,point:[0,0,1]}])
    expect(()=>h.commit({...frame(2),locks:[0]})).toThrow(/bloccato/)
    expect(h.current?.net.poles[0][2]).toBe(1)
    h.commit({...frame(1),locks:[]});h.commit(frame(2));h.commit({...frame(2),locks:[0]})
    expect(h.current?.lockSnapshots).toEqual([{index:0,point:[0,0,2]}])
    expect(h.step(-1)?.lockSnapshots).toEqual([])
    expect(h.step(-1)?.lockSnapshots).toEqual([])
    expect(h.step(-1)?.lockSnapshots).toEqual([{index:0,point:[0,0,1]}])
    expect(h.step(1)?.lockSnapshots).toEqual([])
    expect(h.step(1)?.net.poles[0][2]).toBe(2)
    expect(h.step(1)?.lockSnapshots).toEqual([{index:0,point:[0,0,2]}])
  })
  it('rejects inconsistent adaptive snapshots without changing the current frame',()=>{
    const h=new SurfaceHistory();h.commit({...frame(),lockSnapshots:[]})
    expect(()=>h.commit({...frame(1),locks:[0],lockSnapshots:[{index:0,point:[0,0,2]}]})).toThrow()
    expect(h.current?.net.poles[0][2]).toBe(0)
  })
  it('does not silently drop adaptive locks when preparation changes or disappears',()=>{
    const h=new SurfaceHistory(),initial=frame()
    const preparation={face:2,refinements:[],originalNet:structuredClone(initial.net),trimLocks:[],hiddenPoles:[]}
    h.commit({...initial,preparation,lockSnapshots:[]})
    h.commit({...frame(),preparation,locks:[0]})
    expect(()=>h.commit({...frame(),locks:[0]})).toThrow(/rimappare/)
    expect(()=>h.commit({...frame(),preparation:{...preparation,face:3},locks:[0]})).toThrow(/rimappare/)
    expect(h.current?.lockSnapshots).toEqual([{index:0,point:[0,0,0]}])
  })
  it('stores independent geometry and does not add a duplicate step', () => {
    const h = new SurfaceHistory(), original = frame()
    const first = h.commit(original)
    original.net.poles[0][2] = 50
    expect(h.current?.net.poles[0][2]).toBe(0)
    expect(h.commit(frame()).net).toBe(first.net)
    expect(h.canUndo).toBe(false)
  })
  it('retains the same geometry reference when only point locks change', () => {
    const h = new SurfaceHistory(), first = h.commit(frame())
    const locked = h.commit({ ...frame(), locks: [3, 1, 3] })
    expect(locked.net).toBe(first.net)
    expect(locked.locks).toEqual([1, 3])
    expect(h.step(-1)?.locks).toEqual([])
    expect(h.step(1)?.locks).toEqual([1, 3])
  })
  it('undoes and redoes geometry and discards the redo branch after a new edit', () => {
    const h = new SurfaceHistory()
    h.commit(frame()); h.commit(frame(1)); h.commit(frame(2))
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    expect(h.step(1)?.net.poles[0][2]).toBe(2)
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    h.commit(frame(3))
    expect(h.canRedo).toBe(false)
    expect(h.step(1)).toBeNull()
  })
  it('restores continuity and free-boundary settings with the correct frame', () => {
    const h = new SurfaceHistory()
    h.commit(frame())
    h.commit({ ...frame(), continuity: 'G0', freeBoundary: true })
    expect(h.step(-1)).toMatchObject({ continuity: 'G1', freeBoundary: false })
    expect(h.step(1)).toMatchObject({ continuity: 'G0', freeBoundary: true })
  })
  it('bounds history and reset drops all earlier frames', () => {
    const h = new SurfaceHistory(3)
    for (let i = 0; i < 4; i++) h.commit(frame(i))
    expect(h.step(-1)?.net.poles[0][2]).toBe(2)
    expect(h.step(-1)?.net.poles[0][2]).toBe(1)
    expect(h.step(-1)).toBeNull()
    h.reset()
    expect(h.current).toBeUndefined()
    expect(h.canUndo || h.canRedo).toBe(false)
  })
})
