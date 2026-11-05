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
import {qualifySurfaceHistory,reopenSurfaceHistory,type SurfaceHistoryReplay} from '../app/surfaceEditHistory'
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
    const qualified=await qualifySurfaceHistory({source,prepared,isStampCurrent:()=>true,
      resultStep:enc(finalStep),noteCount:0,replay,signal:ctrl.signal})
    const previous=useReverse.getState(),past=useHistory.getState().past.length
    const stage=await session.stageEditorCopy(finalStep,'qualified-param.step',
      source.assertCurrent,ctrl.signal,undefined,undefined,qualified)
    expect(useReverse.getState()).toBe(previous)
    expect(useHistory.getState().past).toHaveLength(past)
    const receipt=stage.publish('parametric-qa',await hash(finalStep))
    stage.dispose()
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
    expect(useReverse.getState().stepFiles[reopenedFeature.file.key]).toBe(finalStep)
  },120000)
})
