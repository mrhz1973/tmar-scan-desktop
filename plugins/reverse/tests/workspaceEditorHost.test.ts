// SPDX-License-Identifier: AGPL-3.0-only
// Actual OCCT staging/publication, independent STEP reader, project section roundtrip.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { run, startHeadless, type Headless } from '../../../tests/commandKit'
import { undo, redo, useHistory } from '../../../src/state/historyStore'
import { useShell } from '../../../src/state/shellStore'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { createReverseEditorHost } from '../app/workspaceEditorHost'
import { applyReversePart, collectReversePart } from '../app/projectSection'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import plugin from '../plugin'
import { resetReverse } from './reReset'

let headless: Headless, session: ReverseSession, k: OcctKernel
let sheet: string, solid: string, larger: string
const stops: (() => void)[] = []
beforeAll(async () => {
  plugin.install?.(); headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  k = await OcctKernel.init()
  const box = k.makeBox(20,30,10), changed = k.makeBox(20,30,12), faces = k.getSubShapes(box,'face')
  try {
    solid = k.exportStep(box); larger = k.exportStep(changed)
    const top = faces.find(f => { const b=k.getBoundingBox(f); return Math.abs(b.zmin-10)<1e-6 && Math.abs(b.zmax-10)<1e-6 })!
    sheet = k.exportStep(top)
  } finally { [...faces,box,changed].forEach(h => k.release(h)) }
},120_000)
afterAll(() => { stops.forEach(stop=>stop()); session?.client()?.dispose(); headless?.stop(); k?.[Symbol.dispose]() })
beforeEach(() => { resetReverse(); useNotes.getState().load([]); useShell.getState().setWorkspace('reverse') })
async function imported(text = solid) {
  await run('reverse.import.step',{bytes:new TextEncoder().encode(text),name:'original.step'})
  return useReverse.getState().bodies[0].id
}
async function measure(id: number) {
  const text = (await session.client()!.bodyEditSource(id)).text
  const shape=k.importStep(text), faces=k.getSubShapes(shape,'face'), solids=k.getSubShapes(shape,'solid')
  try { return {valid:k.isValid(shape),faces:faces.length,solids:solids.length,volume:k.getVolume(shape),area:k.getSurfaceArea(shape),box:k.getBoundingBox(shape)} }
  finally { [...faces,...solids,shape].forEach(h=>k.release(h)) }
}
const sourceFor = (id:number, signal=new AbortController().signal) => createReverseEditorHost().readSource(id,signal)

describe('host staged CAD copy transaction', () => {
  it('stages without project mutation then publishes one Undo step, original and notes retained', async () => {
    const id=await imported(), abort=new AbortController(), source=await sourceFor(id,abort.signal)
    useNotes.getState().load([{id:1,text:'Preserve original note',at:[10,15,10],on:[{kind:'scan'}]}])
    const before=useReverse.getState(), past=useHistory.getState().past, notes=useNotes.getState().notes, client=session.client()
    const stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,abort.signal)
    expect(useReverse.getState()).toBe(before); expect(useHistory.getState().past).toBe(past); expect(session.client()).toBe(client)
    const receipt=stage.publish('operation-1','artifact-1')
    stage.dispose()
    expect(receipt.createdBodyIds).toHaveLength(1)
    expect(useReverse.getState().features).toHaveLength(before.features.length+1)
    expect(useHistory.getState().past).toHaveLength(past.length+1)
    expect(useHistory.getState().past.at(-1)?.operationId).toBe('operation-1')
    expect(useNotes.getState().notes).toBe(notes)
    expect(useReverse.getState().selection).toBe(before.selection)
    expect(useReverse.getState().hiddenBodies).toBe(before.hiddenBodies)
    expect(await measure(id)).toMatchObject({valid:true,faces:6,solids:1,volume:6000})
    expect((await measure(receipt.createdBodyIds[0])).volume).toBeCloseTo(7200,6)
    expect(stage.publish('operation-1','artifact-1')).toBe(receipt)
    expect(()=>stage.publish('operation-1','different')).toThrow('altro contenuto')
    expect(useHistory.getState().past).toHaveLength(past.length+1)
    await undo(); await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(1)
    expect(useReverse.getState().stepFiles).toEqual(before.stepFiles)
    expect(useNotes.getState().notes).toBe(notes)
    await redo(); await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect((await measure(receipt.createdBodyIds[0])).volume).toBeCloseTo(7200,6)
    const part=collectReversePart()!
    const epoch=useReverse.getState().documentEpoch
    applyReversePart(JSON.parse(JSON.stringify(part))); await session.settled()
    expect(useReverse.getState().documentEpoch).not.toBe(epoch)
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect((await measure(receipt.createdBodyIds[0])).volume).toBeCloseTo(7200,6)
    expect((await measure(id)).volume).toBeCloseTo(6000,6)
  },120_000)

  it('retains a moved ordinary sheet and creates a valid sheet copy', async () => {
    const id=await imported(sheet)
    await run('reverse.feature.add',{feature:{kind:'moveBody',bodies:[id],translate:[40,0,0]}})
    const abort=new AbortController(),source=await sourceFor(id,abort.signal),before=useReverse.getState()
    const stage=await session.stageEditorCopy(new TextDecoder().decode(source.step),'sheet-copy.step',source.assertCurrent,abort.signal)
    const receipt=stage.publish('sheet-op','sheet-hash');stage.dispose()
    expect(useReverse.getState().features.slice(0,-1)).toEqual(before.features)
    for (const body of [id,receipt.createdBodyIds[0]]) {
      const result=await measure(body)
      expect(result).toMatchObject({valid:true,faces:1,solids:0})
      expect(result.box.xmin).toBeCloseTo(40,6);expect(result.area).toBeCloseTo(600,6)
    }
  },120_000)

  it('rejects invalid STEP without a body, resource or Undo entry', async () => {
    const id=await imported(),source=await sourceFor(id),before=useReverse.getState(),history=useHistory.getState(),client=session.client()
    await expect(session.stageEditorCopy('ISO-10303-21; broken;','bad.step',source.assertCurrent,new AbortController().signal)).rejects.toThrow()
    expect(useReverse.getState()).toBe(before);expect(useHistory.getState()).toBe(history);expect(session.client()).toBe(client)
    expect((await measure(id)).valid).toBe(true)
  },120_000)

  it('rejects source replacement after staging, before publication', async () => {
    const id=await imported(),source=await sourceFor(id)
    const stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,new AbortController().signal)
    useReverse.setState(s=>({stepFiles:{...s.stepFiles}}))
    const before=useReverse.getState(),history=useHistory.getState()
    try {expect(()=>stage.publish('stale','hash')).toThrow('sorgente')}
    finally {stage.dispose()}
    expect(useReverse.getState()).toBe(before);expect(useHistory.getState()).toBe(history)
  },120_000)

  it('restores stores, CAD maps, kernel and history after injected publication failure', async () => {
    const id=await imported(),source=await sourceFor(id)
    const before=useReverse.getState(),history=useHistory.getState(),client=session.client(),mesh=session.meshes.get(id)
    const stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,new AbortController().signal)
    let once=true
    const off=useReverse.subscribe(s=>{if(once && s.features.length>before.features.length){once=false;throw Error('injected observer failure')}})
    try {expect(()=>stage.publish('failure','hash')).toThrow('injected observer failure')}
    finally {off();stage.dispose()}
    expect(useReverse.getState()).toBe(before);expect(useHistory.getState()).toBe(history)
    expect(session.client()).toBe(client);expect(session.meshes.get(id)).toBe(mesh)
    expect((await measure(id)).volume).toBeCloseTo(6000,6)
  },120_000)

  it('rejects an aborted preparation and distinguishes a new same-ID document', async () => {
    const id=await imported(),abort=new AbortController(),source=await sourceFor(id,abort.signal)
    const history=useHistory.getState(), before=useReverse.getState()
    abort.abort()
    await expect(session.stageEditorCopy(larger,'abort.step',source.assertCurrent,abort.signal)).rejects.toThrow('annullata')
    expect(useReverse.getState()).toBe(before);expect(useHistory.getState()).toBe(history)
    const current=await sourceFor(id),part=collectReversePart()!
    applyReversePart(part);await session.settled()
    expect(useReverse.getState().bodies[0].id).toBe(id)
    expect(()=>current.assertCurrent()).toThrow('sorgente')
  },120_000)
  it('rejects a same-ID document replaced while kernel readiness is awaiting', async () => {
    const id = await imported(), part = collectReversePart()!, original = session.startKernel
    let release!: () => void, entered!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { entered = resolve })
    session.startKernel = async () => { await original(); entered(); await wait }
    try {
      const pending = createReverseEditorHost().readSource(id, new AbortController().signal)
      const refused = expect(pending).rejects.toThrow('documento')
      await ready
      applyReversePart(JSON.parse(JSON.stringify(part))); await session.settled()
      expect(useReverse.getState().bodies[0].id).toBe(id)
      const current = useReverse.getState(), history = useHistory.getState()
      release(); await refused
      expect(useReverse.getState()).toBe(current); expect(useHistory.getState()).toBe(history)
    } finally { release(); session.startKernel = original }
  }, 120_000)

})


describe('Apply source visibility policy', () => {
  it('hides only original in the same history action, preserving notes and unrelated later visibility', async () => {
    const id=await imported(), other=await imported(larger)
    // imported() returns the first body; obtain the newly added actual body ID.
    const otherId=useReverse.getState().bodies.find(b=>b.id!==id)!.id
    void other
    useNotes.getState().load([{id:1,text:'Original annotation',at:[1,1,1],on:[{kind:'scan'}]}])
    const source=await sourceFor(id),before=useReverse.getState(),notes=useNotes.getState().notes,past=useHistory.getState().past.length
    const stage=await session.stageEditorCopy(larger,'hidden-source-copy.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:id})
    expect(useReverse.getState()).toBe(before)
    const receipt=stage.publish('hide-original','hash');stage.dispose()
    expect(useHistory.getState().past).toHaveLength(past+1)
    expect(useReverse.getState().hiddenBodies).toContain(id)
    expect(useReverse.getState().bodies.find(b=>b.id===id)?.visible).toBe(false)
    expect(useReverse.getState().bodies.find(b=>b.id===receipt.createdBodyIds[0])?.visible).toBe(true)
    expect(useNotes.getState().notes).toBe(notes)
    expect(useReverse.getState().selection).toBe(before.selection)
    expect((await measure(id)).volume).toBeCloseTo(6000,6)
    useReverse.getState().setBodiesVisible([otherId],false)
    await undo();await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    expect(useReverse.getState().hiddenBodies).not.toContain(id)
    expect(useReverse.getState().hiddenBodies).toContain(otherId)
    expect(useReverse.getState().bodies.find(b=>b.id===id)?.visible).toBe(true)
    await redo();await session.settled()
    expect(useReverse.getState().hiddenBodies).toEqual(expect.arrayContaining([id,otherId]))
    expect(useReverse.getState().bodies.find(b=>b.id===receipt.createdBodyIds[0])?.visible).toBe(true)
    const part=collectReversePart()!;applyReversePart(JSON.parse(JSON.stringify(part)));await session.settled()
    expect(useReverse.getState().hiddenBodies).toEqual(expect.arrayContaining([id,otherId]))
    expect(useReverse.getState().bodies).toHaveLength(3)
    expect((await measure(id)).volume).toBeCloseTo(6000,6)
    expect((await measure(receipt.createdBodyIds[0])).valid).toBe(true)
  },120_000)

  it('keeps a previously hidden original hidden on Undo and Redo', async () => {
    const id=await imported();useReverse.getState().setBodiesVisible([id],false)
    const source=await sourceFor(id),stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:id})
    stage.publish('already-hidden','hash');stage.dispose()
    await undo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([id])
    await redo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([id])
    expect(useReverse.getState().bodies.filter(b=>b.visible)).toHaveLength(1)
  },120_000)

  it('rolls back the source visibility along with CAD/resources/history on failed publication', async () => {
    const id=await imported(),source=await sourceFor(id),before=useReverse.getState(),history=useHistory.getState(),client=session.client()
    const stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:id})
    let first=true
    const off=useReverse.subscribe(s=>{if(first&&s.features.length>before.features.length){first=false;throw Error('visibility publication failure')}})
    try{expect(()=>stage.publish('failed-hide','hash')).toThrow('visibility publication failure')}
    finally{off();stage.dispose()}
    expect(useReverse.getState()).toBe(before);expect(useHistory.getState()).toBe(history);expect(session.client()).toBe(client)
    expect(useReverse.getState().bodies[0].visible).toBe(true)
  },120_000)

  it('does not hide anything when staged Apply is cancelled', async () => {
    const id=await imported(),abort=new AbortController(),source=await sourceFor(id,abort.signal),before=useReverse.getState()
    const stage=await session.stageEditorCopy(larger,'copy.step',source.assertCurrent,abort.signal,{hideSourceBodyId:id})
    abort.abort();expect(()=>stage.publish('cancelled-hide','hash')).toThrow();stage.dispose()
    expect(useReverse.getState()).toBe(before)
  },120_000)

  it('rejects a missing source ID without any mutation', async () => {
    const id=await imported(),source=await sourceFor(id),before=useReverse.getState()
    await expect(session.stageEditorCopy(larger,'copy.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:999999})).rejects.toThrow('sorgente')
    expect(useReverse.getState()).toBe(before)
  },120_000)

  it('restores each source independently through a chain of copies', async () => {
    const first=await imported()
    const copy=async (id:number,op:string) => {
      const source=await sourceFor(id),stage=await session.stageEditorCopy(new TextDecoder().decode(source.step),op+'.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:id})
      const result=stage.publish(op,op);stage.dispose();return result.createdBodyIds[0]
    }
    const second=await copy(first,'first-copy'),third=await copy(second,'second-copy')
    expect(useReverse.getState().hiddenBodies).toEqual([first,second])
    await undo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([first])
    await undo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([])
    await redo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([first])
    await redo();await session.settled();expect(useReverse.getState().hiddenBodies).toEqual([first,second])
    expect(useReverse.getState().bodies.filter(b=>b.visible).map(b=>b.id)).toEqual([third])
  },120_000)

  it('applies the visibility policy to an ordinary open sheet without altering its area', async () => {
    const id=await imported(sheet),source=await sourceFor(id),stage=await session.stageEditorCopy(new TextDecoder().decode(source.step),'sheet.step',source.assertCurrent,new AbortController().signal,{hideSourceBodyId:id})
    const receipt=stage.publish('hide-sheet','hash');stage.dispose()
    expect(useReverse.getState().hiddenBodies).toEqual([id])
    for(const body of [id,receipt.createdBodyIds[0]]) {
      const value=await measure(body)
      expect(value).toMatchObject({valid:true,faces:1,solids:0})
      expect(value.area).toBeCloseTo(600,9) // OCCT roundoff, about 1e-13 mm².
    }
    await undo();await session.settled();expect(useReverse.getState().bodies[0].visible).toBe(true)
  },120_000)
})
