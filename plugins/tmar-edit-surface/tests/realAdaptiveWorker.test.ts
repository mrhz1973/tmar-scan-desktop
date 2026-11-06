// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in: dispatches through the real worker implementation, not a browser UI.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { SurfaceDraft } from '../surfaceDraft'
import { updateAdaptiveLocks } from '../adaptiveLockSnapshot'
import type { Net } from '../brep'
import type { Request } from '../editor.worker'
import type { KnotInsertion } from '../refineClampedNet'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'

const path=process.env.SURFACE_QA_STEP
it.skipIf(!path || process.env.SURFACE_QA_ADAPTIVE_PROBE!=='1')('fences adaptive worker selection and replays v8 on the real STEP',async()=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,input=readFileSync(path!)
  const imported=k.importStep(input.toString('utf8')),solids=k.getSubShapes(imported,'solid')
  const load=vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  const client={onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
    postMessage(message:Request){host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>)},terminate(){}}
  const host={onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
    postMessage(value:unknown){client.onmessage?.({data:structuredClone(value)} as MessageEvent)}}
  let runtime:SurfaceRuntime|undefined
  try {
    const step=k.exportStep(solids[0]);vi.stubGlobal('self',host);await import('../editor.worker')
    runtime=new SurfaceRuntime(()=>client as unknown as Worker)
    const worker=runtime.worker
    await worker.ask({action:'open',step})
    const picked=await worker.ask<{net:Net;witnessPole:number;selection:{face:number;refinements:KnotInsertion[];trimPolicy:'circular-fine-v1';generation:number;trimLocks:number[];hiddenPoles:number[]}}>({action:'selectAdaptiveExperimental',face:7})
    const net=picked.net,p=net.poles[picked.witnessPole]
    // Exercise a nonzero pole edit; geometric influence is tested separately.
    net.poles[picked.witnessPole]=[p[0]+.02,p[1],p[2]]
    const locks=updateAdaptiveLocks(net,[],[picked.witnessPole])
    await expect(worker.ask({action:'evaluate',net,continuity:'G1'})).rejects.toThrow(/esplicita/)
    const stale={...picked.selection,trimPolicy:'legacy'}
    await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:stale} as never)).rejects.toThrow(/scaduta/)
    const changedProtection={...picked.selection,trimLocks:[] as number[]}
    if (picked.selection.trimLocks.length) {
      await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:changedProtection})).rejects.toThrow(/scaduta/)
    } else {
      changedProtection.trimLocks=[0]
      await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:changedProtection})).rejects.toThrow(/scaduta/)
    }
    const preview=await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})
    expect(preview.valid).toBe(true)
    const recipe=await worker.ask<{version:number}>({action:'createAdaptiveLockedRecipe',net,continuity:'G1',locks,bodyId:'worker-qa',selection:picked.selection})
    expect(recipe.version).toBe(8)
    const replay=await worker.ask<{valid:boolean;step:string}>({action:'replayAdaptiveLockedRecipe',step,recipe,bodyId:'worker-qa'})
    expect(replay.valid).toBe(true);expect(replay.step).toBeTruthy()
    await expect(worker.ask({action:'restoreAdaptiveLockedRecipe',step,recipe,bodyId:'wrong-source'})).rejects.toThrow()
    // The replay must not replace the active selection.
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).valid).toBe(true)
    await expect(worker.ask({action:'select',face:-1})).rejects.toThrow()
    await expect(worker.ask({action:'prepareCylinder',face:-1})).rejects.toThrow()
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).valid).toBe(true)
    const restored=await worker.ask<{net:Net;lockSnapshots:typeof locks;selection:typeof picked.selection}>({action:'restoreAdaptiveLockedRecipe',step,recipe,bodyId:'worker-qa'})
    expect(restored.lockSnapshots).toEqual(locks)
    expect(restored.selection.generation).not.toBe(picked.selection.generation)
    await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).rejects.toThrow(/scaduta/)
    const savedAgain=await worker.ask<{version:number}>({action:'createAdaptiveLockedRecipe',net:restored.net,continuity:'G1',locks:restored.lockSnapshots,bodyId:'worker-qa',selection:restored.selection})
    expect(savedAgain.version).toBe(8)
    await worker.ask({action:'open',step})
    const again=await worker.ask<typeof picked>({action:'selectAdaptiveExperimental',face:7})
    expect(again.selection.generation).not.toBe(picked.selection.generation)
    await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).rejects.toThrow(/scaduta/)
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net:again.net,continuity:'G1',selection:again.selection})).valid).toBe(true)
    const draft=new SurfaceDraft(runtime)
    try {
      draft.install(again.net,{face:again.selection.face,refinements:again.selection.refinements,
        trimLocks:again.selection.trimLocks,hiddenPoles:again.selection.hiddenPoles,
        adaptiveSelection:again.selection,experimentalAdaptiveLocks:true})
      const waitDraft=()=>new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{unsubscribe();reject(new Error('Anteprima adattiva scaduta'))},30000)
        const unsubscribe=draft.subscribe(()=>{
          const state=draft.getSnapshot()
          if (!state.calculating && (state.validNet || state.error)) {
            clearTimeout(timeout);unsubscribe();state.error ? reject(new Error(state.error)) : resolve()
          }
        })
      })
      await waitDraft()
      expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
      const exported=await draft.evaluateForExport()
      expect(exported.valid).toBe(true);expect(exported.step).toBeTruthy()
      draft.setLocks([again.witnessPole])
      const draftRecipe=await draft.createAdaptiveLockedRecipe('worker-qa')
      expect(draftRecipe.version).toBe(8)
      expect(draftRecipe.lockedValues).toEqual([{index:again.witnessPole,point:again.net.poles[again.witnessPole]}])
      await waitDraft()
      const draftRestored=await draft.restoreAdaptiveLockedRecipe(step,draftRecipe,'worker-qa')
      expect(draftRestored.lockSnapshots).toEqual(draftRecipe.lockedValues)
      expect(runtime.history.current?.lockSnapshots).toEqual(draftRecipe.lockedValues)
      expect(runtime.history.current?.preparation?.adaptiveSelection?.generation).not.toBe(again.selection.generation)
      await waitDraft()
      expect((await draft.createAdaptiveLockedRecipe('worker-qa')).lockedValues).toEqual(draftRecipe.lockedValues)
      await waitDraft()
      await expect(draft.restoreAdaptiveLockedRecipe('invalid STEP',draftRecipe,'worker-qa')).rejects.toThrow()
      expect(draft.getSnapshot().validNet).toBeNull()
      expect(()=>draft.setLocks([])).toThrow(/non verificabile/)
      await draft.restoreAdaptiveLockedRecipe(step,draftRecipe,'worker-qa')
      await waitDraft()
      expect(runtime.history.current?.lockSnapshots).toEqual(draftRecipe.lockedValues)
      expect(()=>draft.setFreeBoundary(true)).toThrow(/protetti/)
    } finally {draft.dispose()}
    // Exercise the session boundary with the same real dispatcher/kernel, but
    // a simulated host and no browser or project persistence.
    const bytes=new TextEncoder().encode(step),digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
    const abort=new AbortController(), binding={documentEpoch:'qa',sourceEpoch:1,bodyId:1,bodyKey:'worker-qa',buildVersion:1,
      kernelGeneration:1,frameRevision:1,stepSha256:digest(bytes),units:'mm',coordinateFrame:'part'}
    const context={apiVersion:1,sessionId:'adaptive-session',source:binding,step:bytes,
      capabilities:{apiVersion:1,enabled:true,commitKinds:['cad-copy']},signal:abort.signal,
      assertSourceCurrent:()=>{},own:(fn:()=>void)=>fn,reportFatal:vi.fn()}
    const waitSession=(session:WorkspaceSurfaceSession)=>new Promise<void>((resolve,reject)=>{
      if(session.getSnapshot().validation.kind==='valid') return resolve()
      const timeout=setTimeout(()=>{unsubscribe();reject(new Error('Sessione adattiva scaduta'))},30000)
      const unsubscribe=session.subscribe(()=>{
        const state=session.getSnapshot()
        if(state.validation.kind==='valid'){clearTimeout(timeout);unsubscribe();resolve()}
      })
    })
    const session=await createWorkspaceSurfaceSession(context as never,vi.fn() as never,{runtime,sha256:async data=>digest(data)})
    try {
      await session.chooseFace(7,false,true)
      await waitSession(session)
      expect(session.getViewState().locked).not.toContain(again.witnessPole)
      const beforePoint=structuredClone(session.getPanelState().net!.poles[again.witnessPole])
      session.selectPoints([again.witnessPole],false)
      session.moveSelected(.02)
      expect(session.getPanelState().net!.poles[again.witnessPole]).not.toEqual(beforePoint)
      expect(session.getSnapshot().validation.kind).not.toBe('valid')
      await waitSession(session)
      session.lockSelected(true)
      const prepared=await session.prepareHistoryRecipe()
      expect(prepared.recipe.version).toBe(8)
      const saved=structuredClone(prepared.recipe),poles=structuredClone(session.getPanelState().net!.poles)
      await session.dispose('cancelled')
      runtime=new SurfaceRuntime(()=>client as unknown as Worker)
      const reopened=await createWorkspaceSurfaceSession({...context,sessionId:'adaptive-reopen'} as never,vi.fn() as never,{runtime,sha256:async data=>digest(data)})
      try {
        await reopened.restoreHistoryRecipe(saved)
        await reopened.waitRestoredHistoryReady()
        expect(reopened.getPanelState().net?.poles).toEqual(poles)
        expect(reopened.getPanelState().manualLocks).toContain(again.witnessPole)
        expect(reopened.getSnapshot().validation.kind).toBe('valid')
      } finally {await reopened.dispose('cancelled')}
    } finally {await session.dispose('cancelled')}
  } finally {runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()}
},120000)
