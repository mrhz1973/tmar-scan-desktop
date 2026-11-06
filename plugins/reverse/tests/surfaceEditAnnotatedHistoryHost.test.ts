// SPDX-License-Identifier: AGPL-3.0-only
// Isolated host opt-in: independent OCCT recipe replay + validated note witness,
// atomic Apply-copy provenance, Undo/Redo and a native project archive roundtrip.
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest'
import {SurfaceEditorKernel} from '../../tmar-edit-surface/editorKernel'
import {run,startHeadless,type Headless} from '../../../tests/commandKit'
import {editorSha256} from '../../../src/plugins/editorLifetime'
import {validateAnnotatedCopy} from '../../../src/plugins/annotatedCopyValidation'
import type {AnnotatedTicketV1,PreparedAnnotatedCopyV1} from '../../../src/plugins/annotatedCopyTypes'
import {useReverse} from '../state/reStore'
import {useNotes} from '../state/noteStore'
import {notesForFile,validateNotes} from '../core/notes'
import {useHistory,undo,redo} from '../../../src/state/historyStore'
import {useShell} from '../../../src/state/shellStore'
import {createReverseSession,installReverseSession,type ReverseSession} from '../app/reSession'
import {createReverseEditorHost} from '../app/workspaceEditorHost'
import {collectReversePart,applyReversePart} from '../app/projectSection'
import {revalidateAnnotations} from '../app/annotationPersistence'
import {qualifyAnnotatedSurfaceHistory,reopenSurfaceHistory,restoreVerifiedSurfaceHistory,withFrozenHistoryTransaction,type SurfaceHistoryReplay} from '../app/surfaceEditHistory'
import {ReClient} from '../core/reClient'
import {localKernel} from './reLocal'
import {resetReverse} from './reReset'
import plugin from '../plugin'
import type {ImportFeature} from '../core/features'

let headless:Headless,session:ReverseSession,editor:SurfaceEditorKernel
const disposers:(()=>void)[]=[]
const enc=(s:string)=>new TextEncoder().encode(s)
const digest=(s:string)=>editorSha256(enc(s))
beforeAll(async()=>{
  plugin.install?.()
  headless=await startHeadless()
  session=createReverseSession({sceneRef:{current:null},kernel:()=>new ReClient(localKernel())})
  disposers.push(installReverseSession(session),session.watch())
  editor=await SurfaceEditorKernel.load()
},120000)
afterAll(()=>{disposers.forEach(f=>f());session?.client()?.dispose();headless?.stop();editor?.dispose()})
beforeEach(()=>{resetReverse();useNotes.getState().load([]);useShell.getState().setWorkspace('reverse')})

describe('independently replay-qualified, atomic annotated history sidecar',()=>{
  it('binds note UV/witness/feature UUID and preserves CAD plus notes across Undo/Redo and project reload',async()=>{
    const k=editor.kernel,shape=k.makeBox(20,30,10),upstreamStep=k.exportStep(shape)
    k.release(shape)
    await run('reverse.import.step',{bytes:enc(upstreamStep),name:'unmodified-source.step'})
    const source=await createReverseEditorHost().readSource(1,new AbortController().signal)
    const original=new TextDecoder().decode(source.step)
    const faces=editor.open(original).faces
    const face=faces.find(f=>editor.select(f.index).poles.every(p=>Math.abs(p[2]-10)<1e-6))!
    const net=editor.select(face.index)
    net.poles[12][2]+=1
    const recipe=await editor.createRecipe(net,'G1',[],source.binding.bodyKey)
    const replay:SurfaceHistoryReplay=async(step,r,key)=>(await editor.replayRecipe(step,r,key)).step!
    const finalStep=await replay(original,recipe,source.binding.bodyKey,new AbortController().signal)
    const finalShape=k.importStep(finalStep),resultFaces=k.getSubShapes(finalShape,'face')
    const selected=resultFaces[recipe.faceIndex]
    const bounds=k.uvBounds(selected)
    const u=(bounds.uMin+bounds.uMax)/2,v=(bounds.vMin+bounds.vMax)/2
    const point=k.pointOnSurface(selected,u,v),normal=k.surfaceNormal(selected,u,v)
    const noteUV:[number,number]=[u,v]
    const witness=k.toBREP(selected),witnessHash=await digest(witness)
    const at:[number,number,number]=[point.x,point.y,point.z]
    const oriented:[number,number,number]=[normal.x,normal.y,normal.z]
    resultFaces.forEach(f=>k.release(f));k.release(finalShape)
    const stamp={sessionId:'anno-history-test',sourceEpoch:source.binding.sourceEpoch,selectionEpoch:1,draftEpoch:1,requestId:1}
    const ticket:AnnotatedTicketV1={annotationVersion:1,mode:'annotated-cad-copy',operationId:'atomic-anno-history',
      source:source.binding,stamp,notesRevision:1}
    const stepHash=await digest(finalStep)
    const payload:PreparedAnnotatedCopyV1={annotationVersion:1,kind:'annotated-cad-copy',operationId:ticket.operationId,
      source:source.binding,stamp,notesRevision:1,units:'mm',coordinateFrame:'part',
      name:'annotation-history.step',step:enc(finalStep),
      witnesses:[{kind:'occt-face-brep',key:'face',brep:witness,
        brepSha256:witnessHash,finalStepSha256:stepHash,stamp,diagnosticFaceIndex:recipe.faceIndex}],
      notes:[{draftId:'note-qa-1',text:'Note on edited face',target:{kind:'copy-face',witnessKey:'face',
        sourceUV:noteUV,resolvedAt:at,orientedNormal:oriented,resolvedStamp:stamp}}]}
    const plan=await validateAnnotatedCopy(payload,ticket)
    const binding=source.binding
    const prepared={recipe,notes:[{id:'note-qa-1',text:'Note on edited face',faceIndex:recipe.faceIndex,u,v}],
      notesRevision:1,sessionId:stamp.sessionId,selectionEpoch:stamp.selectionEpoch,draftEpoch:stamp.draftEpoch,
      sourceKey:JSON.stringify([binding.documentEpoch,binding.sourceEpoch,binding.bodyId,binding.bodyKey,
        binding.buildVersion,binding.kernelGeneration,binding.frameRevision,binding.stepSha256,binding.units,binding.coordinateFrame])}
    const controller=new AbortController()
    await expect(qualifyAnnotatedSurfaceHistory({source,prepared:{...prepared,
      notes:[{...prepared.notes[0],text:'forged text'}]},annotationPlan:plan,
      isStampCurrent:()=>true,resultStep:enc(finalStep),replay,signal:controller.signal})).rejects.toThrow('non coincidono')
    const initialHistory=useHistory.getState().past.length
    const initialStore=useReverse.getState()
    let frozen=true,releaseCount=0
    const receipt=await withFrozenHistoryTransaction({
      freezeHistory:(value)=>{
        expect(value).toBe(prepared)
        return {isCurrent:()=>frozen,release:()=>{releaseCount++;frozen=false}}
      },
    },prepared,async gate=>{
      const qualified=await qualifyAnnotatedSurfaceHistory({source,prepared,annotationPlan:plan,
        isStampCurrent:()=>{gate.assertCurrent();return true},
        resultStep:enc(finalStep),replay,signal:controller.signal})
      expect(qualified.record.notePolicy).toBe('annotated-v1')
      const staging=await session.stageEditorCopy(finalStep,'annotated-history.step',
        source.assertCurrent,controller.signal,undefined,plan,gate.bindQualified(qualified))
      try {
        expect(useReverse.getState()).toBe(initialStore)
        gate.assertCurrent()
        return staging.publish(ticket.operationId,plan.artifactSha256)
      }finally {staging.dispose()}
    })
    expect(releaseCount).toBe(1)
    expect(frozen).toBe(false)
    expect(receipt.mode).toBe('annotated-cad-copy')
    expect(useHistory.getState().past.length).toBe(initialHistory+1)
    expect(useNotes.getState().notes).toHaveLength(1)
    const feature=useReverse.getState().features.at(-1) as ImportFeature
    expect(feature.surfaceEditHistory).toBeDefined()
    expect(feature.annotationSource?.featureUuid).toBe(receipt.createdFeatureUuid)
    const check=await reopenSurfaceHistory(feature,useReverse.getState().stepFiles,replay,
      new AbortController().signal,useNotes.getState().notes)
    expect(check.status).toBe('verified')
    if(check.status!=='verified')throw Error('Expected verified history')
    expect(check.notesToRestore).toMatchObject([{id:'note-qa-1',text:'Note on edited face',faceIndex:recipe.faceIndex}])
    const id=useNotes.getState().notes[0].id
    useNotes.getState().setText(id,'Updated note in project')
    const updated=await reopenSurfaceHistory(feature,useReverse.getState().stepFiles,replay,
      new AbortController().signal,useNotes.getState().notes)
    expect(updated.status).toBe('verified')
    if(updated.status==='verified')expect(updated.notesToRestore?.[0].text).toBe('Updated note in project')
    const missing=await reopenSurfaceHistory(feature,useReverse.getState().stepFiles,replay,new AbortController().signal,[])
    expect(missing.status).toBe('copy-only')
    expect((await reopenSurfaceHistory(feature,useReverse.getState().stepFiles,undefined,
      new AbortController().signal,useNotes.getState().notes)).status).toBe('copy-only')
    const members=new Map<string,Uint8Array>()
    const part=JSON.parse(JSON.stringify(collectReversePart({addMember:(n,b)=>members.set(n,b.slice())})))
    const persistedNotes=JSON.parse(JSON.stringify(notesForFile(useNotes.getState().notes)))
    await undo();await session.settled()
    expect(useNotes.getState().notes).toHaveLength(0)
    expect(useReverse.getState().features).toHaveLength(initialStore.features.length)
    await redo();await session.settled()
    expect(useReverse.getState().features).toHaveLength(initialStore.features.length+1)
    expect(useNotes.getState().notes[0].attachment?.noteUuid).toBe(receipt.notes?.[0].noteUuid)
    applyReversePart(part,{manifest:{} as never,members});useNotes.getState().load(validateNotes(persistedNotes))
    await session.settled();await revalidateAnnotations()
    const restored=useReverse.getState().features.at(-1) as ImportFeature
    const verified=await reopenSurfaceHistory(restored,useReverse.getState().stepFiles,replay,
      new AbortController().signal,useNotes.getState().notes)
    expect(verified.status).toBe('verified')
    if(verified.status==='verified') {
      expect(verified.notesToRestore?.[0].text).toBe('Updated note in project')
      // Host adapter contract simulation: only a fresh controller may accept
      // the exact archived upstream bytes, recipe and verified note UVs.
      const calls:string[]=[]
      const fresh=()=>({
        restoreHistoryRecipe:async(value:unknown)=>{calls.push('recipe');expect(value).toEqual(recipe)},
        restoreHistoryNotes:async(value:unknown)=>{calls.push('notes');expect(value).toEqual(verified.notesToRestore)},
        getSnapshot:()=>({validation:{kind:'valid'}}),
        dispose:async()=>{calls.push('disposed')},
      })
      await restoreVerifiedSurfaceHistory(verified,async(bytes,key)=>{
        calls.push('fresh');expect(new TextDecoder().decode(bytes)).toBe(verified.sourceStep)
        expect(key).toBe(source.binding.bodyKey);return fresh()
      },async()=>{calls.push('validated')},()=>{},new AbortController().signal)
      expect(calls).toEqual(['fresh','recipe','validated','notes'])
      await expect(restoreVerifiedSurfaceHistory(verified,async()=>fresh(),
        async()=>{},()=>{},new AbortController().signal)).rejects.toThrow('già utilizzato')
      const failVerified=await reopenSurfaceHistory(restored,useReverse.getState().stepFiles,
        replay,new AbortController().signal,useNotes.getState().notes)
      expect(failVerified.status).toBe('verified')
      if(failVerified.status==='verified'){
        const rejected:string[]=[]
        await expect(restoreVerifiedSurfaceHistory(failVerified,async()=>({
          restoreHistoryRecipe:async()=>{rejected.push('recipe')},
          restoreHistoryNotes:async()=>{throw Error('injected note reattachment failure')},
          getSnapshot:()=>({validation:{kind:'valid'}}),
          dispose:async()=>{rejected.push('disposed')},
        }),async()=>{},()=>{},new AbortController().signal)).rejects.toThrow('injected')
        expect(rejected).toEqual(['recipe','disposed'])
        expect(useReverse.getState().stepFiles[restored.file.key]).toBe(finalStep)
      }
    }
    expect(useReverse.getState().stepFiles[restored.file.key]).toBe(finalStep)
  },120000)
})
