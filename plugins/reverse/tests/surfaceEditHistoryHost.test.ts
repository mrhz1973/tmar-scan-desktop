// SPDX-License-Identifier: AGPL-3.0-only
// Host-only, opt-in parametrized STEP snapshot: real OCCT recipe replay, atomic CAD history, project archive.
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'
import {SurfaceEditorKernel} from '../../tmar-edit-surface/editorKernel'
import {run,startHeadless,type Headless} from '../../../tests/commandKit'
import {useReverse} from '../state/reStore'
import {useHistory,undo,redo} from '../../../src/state/historyStore'
import {useShell} from '../../../src/state/shellStore'
import {useNotes} from '../state/noteStore'
import {createReverseSession,installReverseSession,type ReverseSession} from '../app/reSession'
import {createReverseEditorHost} from '../app/workspaceEditorHost'
import {collectReversePart,applyReversePart,STEP_MEMBER} from '../app/projectSection'
import {qualifySurfaceHistory,reopenSurfaceHistory,reopenAndRestoreSurfaceHistory,withFrozenHistoryTransaction,type SurfaceHistoryReplay} from '../app/surfaceEditHistory'
import {prepareHostSurfaceHistoryRecovery} from '../app/surfaceHistoryRecovery'
import {editorSha256} from '../../../src/plugins/editorLifetime'
import {ReClient} from '../core/reClient'
import {localKernel} from './reLocal'
import {resetReverse} from './reReset'

import plugin from '../plugin'
import type {ImportFeature} from '../core/features'

let headless:Headless,session:ReverseSession,editor:SurfaceEditorKernel
const stops:(()=>void)[]=[]
const enc=(s:string)=>new TextEncoder().encode(s)
const hash=(s:string)=>editorSha256(enc(s))
beforeAll(async()=>{
  plugin.install?.()
  headless=await startHeadless()
  session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  stops.push(installReverseSession(session),session.watch())
  editor=await SurfaceEditorKernel.load()
},120000)
afterAll(()=>{stops.forEach(stop=>stop());session?.client()?.dispose();headless?.stop();editor?.dispose()})
beforeEach(()=>{resetReverse();useNotes.getState().load([]);useShell.getState().setWorkspace('reverse')})

describe('opt-in host history publication and project restoration',()=>{
  it('stages a replay-qualified exact source and result in one reversible commit',async()=>{
    const box=editor.kernel.makeBox(20,30,10)
    const imported=editor.kernel.exportStep(box);editor.kernel.release(box)
    await run('reverse.import.step',{bytes:enc(imported),name:'upstream.step'})
    const id=useReverse.getState().bodies[0].id
    const ctrl=new AbortController(),source=await createReverseEditorHost().readSource(id,ctrl.signal)
    const upstream=new TextDecoder().decode(source.step)
    const opened=editor.open(upstream)
    const face=opened.faces.find(f=>editor.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-6))
    expect(face).toBeDefined()
    const net=editor.select(face!.index)
    net.poles[12][2]+=1
    const recipe=await editor.createRecipe(net,'G1',[],source.binding.bodyKey)
    const replay:SurfaceHistoryReplay=async(text,recipe,key)=> (await editor.replayRecipe(text,recipe,key)).step!
    const finalStep=await replay(upstream,recipe,source.binding.bodyKey,ctrl.signal)
    const prepared={recipe,sessionId:'host-test-session',
      sourceKey:JSON.stringify([source.binding.documentEpoch,source.binding.sourceEpoch,
        source.binding.bodyId,source.binding.bodyKey,source.binding.buildVersion,
        source.binding.kernelGeneration,source.binding.frameRevision,
        source.binding.stepSha256,source.binding.units,source.binding.coordinateFrame]),
      selectionEpoch:3,draftEpoch:9}
    const previous=useReverse.getState(),past=useHistory.getState().past.length
    // Simulate revocation AFTER an isolated CAD candidate was built but
    // BEFORE the host historyAtomic commit; no body or history may publish.
    let revoked=false,revokedReleased=0
    await withFrozenHistoryTransaction({
      freezeHistory:()=>({isCurrent:()=>!revoked,release:()=>{revokedReleased++}}),
    },prepared,async gate=>{
      const staleQualified=await qualifySurfaceHistory({source,prepared,
        isStampCurrent:()=>{gate.assertCurrent();return true},
        resultStep:enc(finalStep),noteCount:0,replay,signal:ctrl.signal})
      const staged=await session.stageEditorCopy(finalStep,'revoked-param.step',
        source.assertCurrent,ctrl.signal,undefined,undefined,gate.bindQualified(staleQualified))
      try{
        const sha=await hash(finalStep)
        revoked=true
        expect(()=>staged.publish('revoked-history',sha)).toThrow('Freeze')
      }finally{staged.dispose()}
    })
    expect(revokedReleased).toBe(1)
    expect(useReverse.getState()).toBe(previous)
    expect(useHistory.getState().past).toHaveLength(past)
    let lockActive=true, released=0
    const receipt=await withFrozenHistoryTransaction({
      freezeHistory: (value)=> {
        expect(value).toBe(prepared)
        return {isCurrent:()=>lockActive,release:()=>{released++;lockActive=false}}
      },
    },prepared,async gate=>{
      const qualified=await qualifySurfaceHistory({source,prepared,
        isStampCurrent:()=>{gate.assertCurrent();return true},
        resultStep:enc(finalStep),noteCount:0,replay,signal:ctrl.signal})
      const stage=await session.stageEditorCopy(finalStep,'qualified-param.step',
        source.assertCurrent,ctrl.signal,undefined,undefined,gate.bindQualified(qualified))
      try {
        expect(useReverse.getState()).toBe(previous)
        expect(useHistory.getState().past).toHaveLength(past)
        gate.assertCurrent()
        return stage.publish('parametric-qa',await hash(finalStep))
      } finally {stage.dispose()}
    })
    expect(released).toBe(1)
    expect(lockActive).toBe(false)
    expect(receipt.createdBodyIds).toHaveLength(1)
    expect(useHistory.getState().past).toHaveLength(past+1)
    const stored=useReverse.getState().features.at(-1) as ImportFeature
    expect(stored.kind).toBe('import')
    expect(stored.surfaceEditHistory).toBeDefined()
    const files=useReverse.getState().stepFiles
    const checked=await reopenSurfaceHistory(stored,files,replay,new AbortController().signal)
    expect(checked.status).toBe('verified')
    expect((await reopenSurfaceHistory(stored,files,undefined,new AbortController().signal)).status).toBe('copy-only')
    const archive=new Map<string,Uint8Array>()
    const saved=collectReversePart({addMember:(name,bytes)=>archive.set(name,bytes.slice())})!
    expect(archive.has(STEP_MEMBER)).toBe(true)
    const json=JSON.parse(JSON.stringify(saved))
    expect(json.features.at(-1).surfaceEditHistory).toBeDefined()
    await undo();await session.settled()
    expect(useReverse.getState().features).toHaveLength(previous.features.length)
    expect(useReverse.getState().stepFiles).toEqual(previous.stepFiles)
    await redo();await session.settled()
    expect(useReverse.getState().features).toHaveLength(previous.features.length+1)
    applyReversePart(json,{manifest:{} as never,members:archive})
    await session.settled()
    expect(useReverse.getState().bodies).toHaveLength(2)
    const reopenedFeature=useReverse.getState().features.at(-1) as ImportFeature
    expect((await reopenSurfaceHistory(reopenedFeature,useReverse.getState().stepFiles,replay,new AbortController().signal)).status).toBe('verified')
    expect((await reopenSurfaceHistory(reopenedFeature,useReverse.getState().stepFiles,undefined,new AbortController().signal)).status).toBe('copy-only')

    const savedState=useReverse.getState()
    const restored=await reopenAndRestoreSurfaceHistory(reopenedFeature,savedState.stepFiles,
      [],replay,async(bytes,key)=>({
        restoreHistoryBundle:async(bundle:{recipe:unknown;notes:unknown})=>{
          expect(new TextDecoder().decode(bytes)).toBe(upstream)
          expect(key).toBe(source.binding.bodyKey)
          expect(bundle.recipe).toEqual(recipe)
          expect(bundle.notes).toEqual([])
        },
        getSnapshot:()=>({validation:{kind:'valid'}}),
        getPanelState:()=>({notes:[]}),
        dispose:async(_reason:'host-error'|'cancelled')=>{},
      }),async()=>{},()=>{if(useReverse.getState()!==savedState)throw Error('stale host')},
      new AbortController().signal)
    expect(restored.status).toBe('restored')
    if(restored.status==='restored')await restored.session.dispose('cancelled')

    // Host-only readiness: select the saved feature by stable feature ID,
    // prove its archived upstream STEP and recipe with independent replay,
    // then leave a fresh validated session OFF SCREEN for a future handoff.
    let opens=0, disposes=0
    const makeFreshSession=async(bytes:Uint8Array,key:string)=>({
      restoreHistoryBundle:async(bundle:{recipe:unknown;notes:unknown})=>{
        opens++
        expect(new TextDecoder().decode(bytes)).toBe(upstream)
        expect(key).toBe(source.binding.bodyKey)
        expect(bundle.recipe).toEqual(recipe)
        expect(bundle.notes).toEqual([])
      },
      getSnapshot:()=>({validation:{kind:'valid'}}),
      getPanelState:()=>({notes:[]}),
      dispose:async(_reason:'host-error'|'cancelled')=>{disposes++},
    })
    const recoveryArgs={featureId:reopenedFeature.id,replay,makeFreshSession,
      awaitValidated:async()=>{},signal:new AbortController().signal}
    const ready=await prepareHostSurfaceHistoryRecovery(recoveryArgs)
    expect(ready.status).toBe('ready')
    expect(opens).toBe(1)
    if(ready.status==='ready'){
      expect(ready.record.recipe).toEqual(recipe)
      expect(()=>ready.assertCurrent()).not.toThrow()
      await ready.release()
      await ready.release()
      expect(()=>ready.assertCurrent()).toThrow(/rilasciata/)
    }
    expect(disposes).toBe(1)

    const withoutReplay=await prepareHostSurfaceHistoryRecovery({...recoveryArgs,replay:undefined})
    expect(withoutReplay.status).toBe('copy-only')
    expect(opens).toBe(1)
    expect(await prepareHostSurfaceHistoryRecovery({...recoveryArgs,featureId:99999}))
      .toMatchObject({status:'copy-only'})
    // Mutate only a transient test note store during independent replay:
    // the recovered session must never install or change authoritative CAD.
    const beforeNotes=useNotes.getState().notes
    let extraOpens=0
    const stale=await prepareHostSurfaceHistoryRecovery({
      ...recoveryArgs,
      replay:async(text,r,key,signal)=>{
        const output=await replay(text,r,key,signal)
        useNotes.getState().load([])
        return output
      },
      makeFreshSession:async(bytes,key,_signal)=>{extraOpens++;return makeFreshSession(bytes,key)},
    })
    expect(stale.status).toBe('copy-only')
    expect(extraOpens).toBe(0)
    expect(useNotes.getState().notes).not.toBe(beforeNotes)
    expect(useReverse.getState()).toBe(savedState)
    expect(useReverse.getState().stepFiles[reopenedFeature.file.key]).toBe(finalStep)
  },120000)
})
