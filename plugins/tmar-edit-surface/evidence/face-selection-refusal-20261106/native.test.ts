import {it,expect} from 'vitest'
import {writeFileSync,mkdtempSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {SurfaceEditorKernel} from '../../editorKernel'
import {SurfaceRuntime} from '../../surfaceRuntime'
import {SurfaceDraft} from '../../surfaceDraft'
import {changeSurfaceFace} from '../../faceSelection'
import {SurfaceWorkerRequestError} from '../../workerClient'

it('preserves a draft after real OCCT select refusal and permits a subsequent CAD edit',async()=>{
 const out=mkdtempSync(resolve('plugins/tmar-edit-surface/evidence/face-selection-refusal-20261106/native-'))
 const report:any={scope:'real OCCT WASM in Node; in-process transport bridge, no browser Worker, dialog, host UI or user project',verdict:'INCOMPLETE'}
 const editor=await SurfaceEditorKernel.load(),k=editor.kernel,handles:any[]=[]
 // Transport only is a test bridge. All CAD requests reach the actual kernel.
 const bridge:any={onmessage:null,onerror:null,onmessageerror:null,terminate(){},postMessage(req:any){queueMicrotask(()=>{try{let result:any
  if(req.action==='select')result=editor.select(req.face)
  else if(req.action==='evaluate')result=editor.evaluate(req.net,req.continuity,req.exportStep,req.freeBoundary)
  else throw Error('unexpected bridge action '+req.action)
  this.onmessage?.({data:{id:req.id,result}})
 }catch(e){this.onmessage?.({data:{id:req.id,error:e instanceof Error?e.message:String(e)}})}})}}
 const runtime=new SurfaceRuntime(()=>bridge),draft=new SurfaceDraft(runtime)
 const own=(h:any)=>(handles.push(h),h)
 const ready=async()=>{const end=Date.now()+45000;while(Date.now()<end){const s=draft.getSnapshot();if(s.error)throw Error(s.error);if(s.validNet===s.net&&!s.calculating)return s;await new Promise(r=>setTimeout(r,50))}throw Error('preview timeout')}
 try {
  const box=own(k.makeBox(20,30,10)),pin=own(k.makeCylinder(3,11)),moved=own(k.translate(pin,10,15,9)),body=own(k.fuse(box,moved))
  const step=k.exportStep(body),source=own(k.importStep(step)),faces=k.getSubShapes(source,'face');handles.push(...faces)
  expect(k.isValid(source)).toBe(true)
  const bottom=faces.findIndex(f=>{const b=k.uvBounds(f);return k.surfaceType(f)==='plane'&&Math.abs(k.pointOnSurface(f,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z)<1e-8})
  const opened=editor.open(step),refused=opened.faces.find(f=>f.kind==='cylinder'&&f.reason)!
  expect(bottom).toBeGreaterThanOrEqual(0);expect(refused).toBeDefined()
  const net=await runtime.worker.ask<any>({action:'select',face:bottom})
  draft.install(net);draft.setSelection([12]);await ready()
  const edited=structuredClone(draft.getSnapshot().net!);edited.poles[12][2]-=.2;draft.commit(edited);await ready()
  draft.setLocks([12]);await ready()
  const before=draft.getSnapshot(),history=runtime.history.current,notes=[{text:'Nota QA da conservare',anchor:{u:.5,v:.5}}]
  let currentNotes=notes,face=bottom,invalidated=false
  await expect(changeSurfaceFace({select:()=>runtime.worker.ask<any>({action:'select',face:refused.index}),current:()=>true,
   install:n=>{draft.install(n);face=refused.index;currentNotes=[]},invalidate:()=>{invalidated=true;draft.reset()}})).rejects.toBeInstanceOf(SurfaceWorkerRequestError)
  expect(invalidated).toBe(false);expect(draft.getSnapshot()).toBe(before);expect(runtime.history.current).toBe(history)
  expect(currentNotes).toBe(notes);expect(face).toBe(bottom);expect(before.validNet).toBe(before.net);expect(before.canUndo).toBe(true)
  const witness=editor.finalFaceWitness(before.preview!.previewRevision!)
  expect(witness.faceBrep.length).toBeGreaterThan(0)
  draft.setLocks([]);await ready()
  const next=structuredClone(draft.getSnapshot().net!);next.poles[12][2]-=.1;draft.commit(next)
  const after=await ready();expect(after.preview!.previewRevision).toBeGreaterThan(before.preview!.previewRevision!)
  const exported=await draft.evaluateForExport(),round=own(k.importStep(exported.step))
  expect(k.isValid(round)).toBe(true)
  const solids=k.getSubShapes(round,'solid'),roundFaces=k.getSubShapes(round,'face');handles.push(...solids,...roundFaces)
  expect(solids.length).toBe(1);expect(roundFaces.length).toBe(faces.length)
  const delta=k.getVolume(round)-k.getVolume(source);expect(Math.abs(delta)).toBeGreaterThan(1e-6)
  Object.assign(report,{verdict:'PASS',bottomFace:bottom,refusedFace:refused.index,refusalReason:refused.reason,retainedExactSnapshot:true,retainedHistory:true,retainedNotes:true,retainedWorkerWitness:true,firstPoleZ:before.net!.poles[12][2],secondPoleZ:after.net!.poles[12][2],firstPreviewRevision:before.preview!.previewRevision,secondPreviewRevision:after.preview!.previewRevision,exportValid:true,solidCount:solids.length,faceCount:roundFaces.length,volumeChangeMm3:delta})
  writeFileSync(join(out,'synthetic-source.step'),step);writeFileSync(join(out,'after-refusal-edit.step'),exported.step)
 }catch(e){report.error=String(e instanceof Error?e.stack:e);throw e}
 finally{draft.dispose();runtime.dispose();handles.reverse().forEach(h=>k.release(h));editor.dispose();writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}))}
})
