// SPDX-License-Identifier: AGPL-3.0-only
// Regression: CAD bodies use featureId + islandIndex/1024, not integer-only IDs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { undo, redo, useHistory } from '../../../src/state/historyStore'
import { useShell } from '../../../src/state/shellStore'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { collectReversePart, applyReversePart, STEP_MEMBER } from '../app/projectSection'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { islandId } from '../core/features'
import { useReverse } from '../state/reStore'
import { resetReverse } from './reReset'
import plugin from '../plugin'

let kit: Headless, session: ReverseSession, cad: OcctKernel
const cleanups: (()=>void)[] = []
beforeAll(async()=>{
  plugin.install?.()
  kit=await startHeadless()
  session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  cleanups.push(installReverseSession(session),session.watch())
  cad=await OcctKernel.init()
},120_000)
afterAll(()=>{
  cleanups.forEach(stop=>stop())
  session?.client()?.dispose()
  kit?.stop()
  cad?.[Symbol.dispose]()
})
beforeEach(()=>{resetReverse();useShell.getState().setWorkspace('reverse')})

describe('host Apply on a fractional CAD body ID',()=>{
  it('hides only the exact existing island, then preserves it through Undo/Redo and project reload',async()=>{
    const a=cad.makeBox(20,30,10),b=cad.makeBox(10,12,8),shifted=cad.translate(b,45,0,0)
    let step=''
    const compound=cad.makeCompound([a,shifted])
    try{step=cad.exportStep(compound)}
    finally{[compound,shifted,b,a].forEach(h=>cad.release(h))}
    await run('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'multi-solid.step'})
    const original=useReverse.getState(),ids=original.bodies.map(b=>b.id).sort((x,y)=>x-y)
    expect(ids).toEqual([1,islandId(1,1)])
    const fractional=islandId(1,1)
    expect(fractional).toBe(1.0009765625)
    const source=await createReverseEditorHost().readSource(fractional,new AbortController().signal)
    expect(source.binding.bodyId).toBe(fractional)
    const text=new TextDecoder().decode(source.step)
    const beforeHistory=useHistory.getState().past.length
    const stage=await session.stageEditorCopy(text,'fractional-copy.step',source.assertCurrent,
      new AbortController().signal,{hideSourceBodyId:fractional})
    expect(useReverse.getState()).toBe(original)
    const receipt=stage.publish('fractional-apply','fractional-artifact')
    stage.dispose()
    expect(receipt.createdBodyIds).toHaveLength(1)
    expect(useHistory.getState().past.length).toBe(beforeHistory+1)
    expect(useReverse.getState().hiddenBodies).toContain(fractional)
    expect(useReverse.getState().hiddenBodies).not.toContain(1)
    expect(useReverse.getState().bodies.find(b=>b.id===fractional)?.visible).toBe(false)
    expect(useReverse.getState().bodies.find(b=>b.id===1)?.visible).toBe(true)
    expect(useReverse.getState().bodies).toHaveLength(3)
    await undo(); await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect(useReverse.getState().hiddenBodies).not.toContain(fractional)
    await redo(); await session.settled()
    expect(useReverse.getState().hiddenBodies).toContain(fractional)
    expect(useReverse.getState().bodies).toHaveLength(3)
    const members=new Map<string,Uint8Array>()
    const stored=collectReversePart({addMember:(name,bytes)=>members.set(name,bytes.slice())})!
    expect(members.has(STEP_MEMBER)).toBe(true)
    applyReversePart(JSON.parse(JSON.stringify(stored)),{manifest:{} as never,members})
    await session.settled()
    expect(useReverse.getState().hiddenBodies).toContain(fractional)
    expect(useReverse.getState().hiddenBodies).not.toContain(1)
    expect(useReverse.getState().bodies.find(b=>b.id===fractional)?.visible).toBe(false)
    expect(useReverse.getState().bodies.find(b=>b.id===1)?.visible).toBe(true)
    expect(useReverse.getState().bodies).toHaveLength(3)
  },120_000)

  it('refuses a nonexistent fractional body or non-finite/nonpositive ID without a new history step',async()=>{
    const box=cad.makeBox(10,10,10)
    let step='';try{step=cad.exportStep(box)}finally{cad.release(box)}
    await run('reverse.import.step',{bytes:new TextEncoder().encode(step),name:'single.step'})
    const source=await createReverseEditorHost().readSource(1,new AbortController().signal)
    const original=useReverse.getState(),history=useHistory.getState()
    const text=new TextDecoder().decode(source.step)
    for(const id of [islandId(1,1),Number.NaN,Infinity,-Infinity,0,-1]){
      await expect(session.stageEditorCopy(text,'rejected.step',source.assertCurrent,
        new AbortController().signal,{hideSourceBodyId:id})).rejects.toThrow('Corpo sorgente da nascondere non disponibile.')
      expect(useReverse.getState()).toBe(original)
      expect(useHistory.getState()).toBe(history)
    }
  },120_000)
})
