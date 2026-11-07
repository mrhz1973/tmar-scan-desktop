// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in QA only: host v8 refuses forged note normals and preserves CAD copy/project archive.
// No feature/UI enablement, no source STEP mutation, no plugin source edits.
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {SurfaceEditorKernel} from '../../tmar-edit-surface/editorKernel'
import type {Net} from '../../tmar-edit-surface/brep'
import {run,startHeadless} from '../../../tests/commandKit'
import {useReverse} from '../state/reStore'
import {useHistory,undo,redo} from '../../../src/state/historyStore'
import {useNotes} from '../state/noteStore'
import {useShell} from '../../../src/state/shellStore'
import {notesForFile,validateNotes} from '../core/notes'
import {createReverseSession,installReverseSession} from '../app/reSession'
import {collectReversePart,applyReversePart} from '../app/projectSection'
import {revalidateAnnotations} from '../app/annotationPersistence'
import {createReverseEditorHost} from '../app/workspaceEditorHost'
import {qualifySurfaceHistory,qualifyAnnotatedSurfaceHistory,reopenSurfaceHistory,reopenAndRestoreSurfaceHistory,
  canonicalHistoryJson,withFrozenHistoryTransaction,type SurfaceHistoryReplay,type SurfaceHistoryRestoreController} from '../app/surfaceEditHistory'
import {editorSha256} from '../../../src/plugins/editorLifetime'
import {validateAnnotatedCopy} from '../../../src/plugins/annotatedCopyValidation'
import type {AnnotatedTicketV1,PreparedAnnotatedCopyV1} from '../../../src/plugins/annotatedCopyTypes'
import {ReClient} from '../core/reClient'
import {localKernel} from './reLocal'
import {resetReverse} from './reReset'
import plugin from '../plugin'
import type {ImportFeature} from '../core/features'

const path=process.env.SURFACE_QA_STEP
const enabled=process.env.HOST_SURFACE_V8_QA==='1' && !!path
const encode=(s:string)=>new TextEncoder().encode(s)
const hash=(s:string)=>editorSha256(encode(s))
type Locks={index:number;point:[number,number,number]}[]
type V8={version:8;faceIndex:number;lockedValues:Locks;source:{bodyId:string}}
type QAController=SurfaceHistoryRestoreController & {
  subscribe(listener:()=>void):()=>void
  getPanelState():{notes:readonly {id:string;text:string}[];manualLocks:readonly number[];net:Net|null}
}
type AdaptiveKernel={
  selectAdaptiveExperimental(face:number):{net:Net;witnessPole:number}
  createAdaptiveLockedRecipe(net:Net,mode:'G1',locks:Locks,bodyId:string):Promise<V8>
  replayAdaptiveLockedRecipe(step:string,recipe:unknown,bodyId:string):Promise<{valid:boolean;step?:string}>
}
const asAdaptive=(editor:SurfaceEditorKernel)=>editor as unknown as SurfaceEditorKernel & AdaptiveKernel
function inside(k:SurfaceEditorKernel['kernel'],face:ReturnType<SurfaceEditorKernel['kernel']['getSubShapes']>[number]){
  const b=k.uvBounds(face)
  for(let n=0;n<81;n++) for(let m=0;m<81;m++){
    const u=b.uMin+(b.uMax-b.uMin)*(n+.5)/81,v=b.vMin+(b.vMax-b.vMin)*(m+.5)/81
    if(k.classifyPointOnFace(face,u,v)==='in')return {u,v}
  }
  throw new Error('No interior note witness on selected LEGO annular face')
}
afterEach(()=>vi.unstubAllGlobals())
it.skipIf(!enabled)('host opt-in v8 refuses invalid notes safely and saves/reopens an unannotated CAD copy',async()=>{
  plugin.install?.()
  const headless=await startHeadless()
  const session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  const disposers=[installReverseSession(session),session.watch()]
  const editor=await SurfaceEditorKernel.load()
  const independent=await SurfaceEditorKernel.load()
  let runtime:{dispose():void}|undefined
  try {
    resetReverse();useNotes.getState().load([]);useShell.getState().setWorkspace('reverse')
    // Only the FIRST solid, as in the plugin's real LEGO experimental probes.
    const sourceBytes=readFileSync(path!),raw=editor.kernel.importStep(sourceBytes.toString('utf8'))
    const solids=editor.kernel.getSubShapes(raw,'solid')
    expect(solids.length).toBeGreaterThan(0)
    const solidStep=editor.kernel.exportStep(solids[0])
    solids.forEach(x=>editor.kernel.release(x));editor.kernel.release(raw)
    await run('reverse.import.step',{bytes:encode(solidStep),name:'host-v8-LEGO-QA.step'})
    await session.settled()
    const bodyId=useReverse.getState().bodies[0].id,ctrl=new AbortController()
    const source=await createReverseEditorHost().readSource(bodyId,ctrl.signal)
    const original=new TextDecoder().decode(source.step)
    const adapter=asAdaptive(editor)
    adapter.open(original)
    const picked=adapter.selectAdaptiveExperimental(7)
    const net=structuredClone(picked.net),idx=picked.witnessPole
    net.poles[idx][0]+=.02
    const locks:Locks=[{index:idx,point:[...net.poles[idx]] as [number,number,number]}]
    const evaluated=adapter.evaluate(net,'G1',true)
    expect(evaluated.valid).toBe(true)
    const recipe=await adapter.createAdaptiveLockedRecipe(net,'G1',locks,source.binding.bodyKey)
    expect(recipe.version).toBe(8)
    const replay:SurfaceHistoryReplay=async(step,value,key)=>{
      const r=await asAdaptive(independent).replayAdaptiveLockedRecipe(step,value,key)
      if(!r.valid||!r.step)throw Error('Independent OCCT v8 replay refused')
      return r.step
    }
    const finalStep=await replay(original,recipe,source.binding.bodyKey,ctrl.signal)
    const resultShape=editor.kernel.importStep(finalStep)
    expect(editor.kernel.isValid(resultShape)).toBe(true)
    const faces=editor.kernel.getSubShapes(resultShape,'face')
    const selected=faces[recipe.faceIndex],uv=inside(editor.kernel,selected)
    const point=editor.kernel.pointOnSurface(selected,uv.u,uv.v)
    const normal=editor.kernel.surfaceNormal(selected,uv.u,uv.v)
    const witness=editor.kernel.toBREP(selected),witnessHash=await hash(witness)
    const at:[number,number,number]=[point.x,point.y,point.z]
    const n:[number,number,number]=[normal.x,normal.y,normal.z]
    faces.forEach(f=>editor.kernel.release(f));editor.kernel.release(resultShape)
    const binding=source.binding
    const stamp={sessionId:'host-v8-qa',sourceEpoch:binding.sourceEpoch,selectionEpoch:1,draftEpoch:1,requestId:1}
    const ticket:AnnotatedTicketV1={annotationVersion:1,mode:'annotated-cad-copy',
      operationId:'host-v8-annotated-qa',source:binding,stamp,notesRevision:1}
    const stepHash=await hash(finalStep)
    const noteId='host-v8-note',noteText='Controllare raccordo adattivo'
    const payload:PreparedAnnotatedCopyV1={
      annotationVersion:1,kind:'annotated-cad-copy',operationId:ticket.operationId,
      source:binding,stamp,notesRevision:1,units:'mm',coordinateFrame:'part',
      name:'host-v8-annotated.step',step:encode(finalStep),
      witnesses:[{kind:'occt-face-brep',key:'face',brep:witness,brepSha256:witnessHash,
        finalStepSha256:stepHash,stamp,diagnosticFaceIndex:recipe.faceIndex}],
      notes:[{draftId:noteId,text:noteText,target:{kind:'copy-face',witnessKey:'face',
        sourceUV:[uv.u,uv.v],resolvedAt:at,orientedNormal:n,resolvedStamp:stamp}}],
    }
    const plan=await validateAnnotatedCopy(payload,ticket)
    const prepared={recipe,notes:[{id:noteId,text:noteText,faceIndex:recipe.faceIndex,u:uv.u,v:uv.v}],
      notesRevision:1,sessionId:stamp.sessionId,selectionEpoch:stamp.selectionEpoch,draftEpoch:stamp.draftEpoch,
      sourceKey:JSON.stringify([binding.documentEpoch,binding.sourceEpoch,binding.bodyId,binding.bodyKey,
        binding.buildVersion,binding.kernelGeneration,binding.frameRevision,binding.stepSha256,binding.units,binding.coordinateFrame])}
    const prepInput={source,prepared,annotationPlan:plan,isStampCurrent:()=>true,
      resultStep:encode(finalStep),replay,signal:ctrl.signal}
    // Default path refuses experimental v8; UI and production do not request this permission.
    await expect(qualifyAnnotatedSurfaceHistory(prepInput)).rejects.toThrow(/incompatibile/)
    const prior=useReverse.getState(),priorHistory=useHistory.getState().past.length
    // The thin-face sampling guard is now adaptive. Keep a deterministic negative
    // regression by forging an inverted note normal; never publish partial state.
    const invalidNormalPlan=await validateAnnotatedCopy({...payload,notes:[{
      ...payload.notes[0],target:{...payload.notes[0].target,
        orientedNormal:[-n[0],-n[1],-n[2]] as [number,number,number]},
    }]},ticket)
    await expect(withFrozenHistoryTransaction({
      freezeHistory:()=>({isCurrent:()=>true,release:()=>{}}),
    },prepared,async gate=>{
      const qualified=await qualifyAnnotatedSurfaceHistory({...prepInput,
        annotationPlan:invalidNormalPlan,experimentalAdaptiveV8:true})
      const stage=await session.stageEditorCopy(finalStep,'host-v8-annotated.step',
        source.assertCurrent,ctrl.signal,undefined,invalidNormalPlan,gate.bindQualified(qualified))
      try { return stage.publish(ticket.operationId,invalidNormalPlan.artifactSha256) }
      finally {stage.dispose()}
    })).rejects.toThrow()
    expect(useReverse.getState()).toBe(prior)
    expect(useHistory.getState().past).toHaveLength(priorHistory)
    expect(useNotes.getState().notes).toHaveLength(0)
    // CAD-only v8 is a separate, replay-qualified experimental transaction.
    const plainPrepared={recipe,sessionId:prepared.sessionId,sourceKey:prepared.sourceKey,
      selectionEpoch:prepared.selectionEpoch,draftEpoch:prepared.draftEpoch}
    const receipt=await withFrozenHistoryTransaction({
      freezeHistory:()=>({isCurrent:()=>true,release:()=>{}}),
    },plainPrepared,async gate=>{
      const qualified=await qualifySurfaceHistory({
        source,prepared:plainPrepared,isStampCurrent:()=>true,resultStep:encode(finalStep),
        noteCount:0,replay,signal:ctrl.signal,experimentalAdaptiveV8:true,
      })
      const stage=await session.stageEditorCopy(finalStep,'host-v8-cad-only.step',
        source.assertCurrent,ctrl.signal,undefined,undefined,gate.bindQualified(qualified))
      try {return stage.publish('host-v8-cad-only',await hash(finalStep))}
      finally {stage.dispose()}
    })
    expect(receipt.mode).toBe('cad-copy')
    expect(useHistory.getState().past).toHaveLength(priorHistory+1)
    const published=useReverse.getState().features.at(-1) as ImportFeature
    expect(published.surfaceEditHistory).toBeDefined()
    expect((published.surfaceEditHistory as {recipe:V8}).recipe.version).toBe(8)
    const stepFiles=useReverse.getState().stepFiles,storeNotes=useNotes.getState().notes
    expect((await reopenSurfaceHistory(published,stepFiles,replay,ctrl.signal,storeNotes)).status).toBe('copy-only')
    const verified=await reopenSurfaceHistory(published,stepFiles,replay,ctrl.signal,storeNotes,{experimentalAdaptiveV8:true})
    expect(verified.status).toBe('verified')
    if(verified.status!=='verified')throw Error('Independent v8 reopen failed')
    expect(verified.notesToRestore).toBeUndefined()
    expect((await reopenSurfaceHistory(published,stepFiles,undefined,ctrl.signal,storeNotes,
      {experimentalAdaptiveV8:true})).status).toBe('copy-only')
    const modified=structuredClone(published) as ImportFeature
    ;(modified.surfaceEditHistory as {recipe:{lockedValues:Locks}}).recipe.lockedValues[0].point[0]+=.1
    expect((await reopenSurfaceHistory(modified,stepFiles,replay,ctrl.signal,storeNotes,
      {experimentalAdaptiveV8:true})).status).toBe('copy-only')
    // Even a coordinated JSON/hash rewrite cannot bypass independent OCCT lock validation.
    const recomputed=structuredClone(modified) as ImportFeature
    const rec=recomputed.surfaceEditHistory as {recipe:unknown;recipeSha256:string}
    rec.recipeSha256=await hash(canonicalHistoryJson(rec.recipe))
    expect((await reopenSurfaceHistory(recomputed,stepFiles,replay,ctrl.signal,storeNotes,
      {experimentalAdaptiveV8:true})).status).toBe('copy-only')
    // Native project archive round-trip: preserve v8 CAD copy plus its exact original STEP; annotated v8 still HOLD.
    const members=new Map<string,Uint8Array>()
    const saved=JSON.parse(JSON.stringify(collectReversePart({addMember:(name,bytes)=>members.set(name,bytes.slice())})))
    const savedNotes=JSON.parse(JSON.stringify(notesForFile(storeNotes)))
    await undo();await session.settled()
    expect(useReverse.getState().features).toHaveLength(prior.features.length)
    await redo();await session.settled()
    expect(useReverse.getState().features).toHaveLength(prior.features.length+1)
    applyReversePart(saved,{manifest:{} as never,members})
    useNotes.getState().load(validateNotes(savedNotes))
    await session.settled();await revalidateAnnotations()
    const reopenedFeature=useReverse.getState().features.at(-1) as ImportFeature
    const reopenedNotes=useNotes.getState().notes,reopenedFiles=useReverse.getState().stepFiles
    const after=await reopenSurfaceHistory(reopenedFeature,reopenedFiles,replay,ctrl.signal,
      reopenedNotes,{experimentalAdaptiveV8:true})
    expect(after.status).toBe('verified')
    if(after.status!=='verified')throw Error('Host persisted v8 record failed after reload')
    expect(after.notesToRestore).toBeUndefined()
    const keptState=useReverse.getState(),keptNotes=useNotes.getState().notes
    // The host must leave saved data untouched on missing replay/invalid receipt.
    const denied=await reopenAndRestoreSurfaceHistory(reopenedFeature,reopenedFiles,reopenedNotes,
      undefined,async()=>{throw Error('Factory should not be called')},async()=>{},
      ()=>{},ctrl.signal,{experimentalAdaptiveV8:true})
    expect(denied.status).toBe('copy-only')
    expect(useReverse.getState()).toBe(keptState)
    expect(useNotes.getState().notes).toBe(keptNotes)
    // Full new plugin controller restoration still runs against a simulated host transport:
    // this is not a browser application or packaged app qualification.
    const host={onmessage:null as ((e:MessageEvent)=>void)|null,
      postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
    const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
      postMessage(request:unknown){host.onmessage?.({data:structuredClone(request)} as MessageEvent)},terminate(){}}
    vi.stubGlobal('self',host)
    const loading=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(independent)
    try {
      await import('../../tmar-edit-surface/editor.worker')
      const {SurfaceRuntime}=await import('../../tmar-edit-surface/surfaceRuntime')
      const {createWorkspaceSurfaceSession}=await import('../../tmar-edit-surface/workspaceSession')
      const resumeSignal=new AbortController().signal
      const result=await reopenAndRestoreSurfaceHistory<QAController>(reopenedFeature,reopenedFiles,reopenedNotes,replay,
        async(bytes,bodyKey,signal)=>{
          runtime=new SurfaceRuntime(()=>client as unknown as Worker)
          const sourceStamp={...source.binding,bodyKey,stepSha256:await editorSha256(bytes)}
          return createWorkspaceSurfaceSession({
            apiVersion:1,sessionId:'host-v8-restored',source:sourceStamp,step:bytes,
            capabilities:{apiVersion:1,enabled:true,annotationVersion:1,commitKinds:['cad-copy','annotated-cad-copy']},
            signal,assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn(),
          } as never,vi.fn() as never,{runtime:runtime as InstanceType<typeof SurfaceRuntime>,sha256:editorSha256})
            .then(session=>session as unknown as QAController)
        },async(controller,signal)=>{
          if(controller.getSnapshot().validation.kind==='valid')return
          await new Promise<void>((resolve,reject)=>{
            const timer=setTimeout(()=>{unsub();reject(new Error('Host v8 restore preview timeout'))},30000)
            const unsub=controller.subscribe(()=>{
              if(signal.aborted){clearTimeout(timer);unsub();reject(new Error('Restore aborted'))}
              else if(controller.getSnapshot().validation.kind==='valid'){clearTimeout(timer);unsub();resolve()}
            })
          })
        },()=>{},resumeSignal,{experimentalAdaptiveV8:true})
      expect(result.status).toBe('restored')
      if(result.status==='restored'){
        const panel=result.session.getPanelState() as {notes:readonly {id:string;text:string}[];manualLocks:readonly number[];net:Net|null}
        expect(panel.notes).toEqual([])
        expect(panel.manualLocks).toContain(idx)
        expect(panel.net?.poles[idx]).toEqual(net.poles[idx])
        await result.session.dispose('cancelled')
      }
    } finally {loading.mockRestore()}
    expect(useReverse.getState()).toBe(keptState)
  } finally {
    runtime?.dispose();disposers.forEach(stop=>stop());session.client()?.dispose()
    headless.stop();editor.dispose();independent.dispose()
  }
},240000)
