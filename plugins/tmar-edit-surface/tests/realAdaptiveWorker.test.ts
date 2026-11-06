// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in: dispatches through the real worker implementation, not a browser UI.
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { SurfaceRuntime } from '../surfaceRuntime'
import { updateAdaptiveLocks } from '../adaptiveLockSnapshot'
import type { Net } from '../brep'
import type { Request } from '../editor.worker'
import type { KnotInsertion } from '../refineClampedNet'

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
    const picked=await worker.ask<{net:Net;witnessPole:number;selection:{face:number;refinements:KnotInsertion[];trimPolicy:'circular-fine-v1';generation:number}}>({action:'selectAdaptiveExperimental',face:7})
    const net=picked.net,p=net.poles[picked.witnessPole]
    // Exercise a nonzero pole edit; geometric influence is tested separately.
    net.poles[picked.witnessPole]=[p[0]+.02,p[1],p[2]]
    const locks=updateAdaptiveLocks(net,[],[picked.witnessPole])
    await expect(worker.ask({action:'evaluate',net,continuity:'G1'})).rejects.toThrow(/esplicita/)
    const stale={...picked.selection,trimPolicy:'legacy'}
    await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:stale} as never)).rejects.toThrow(/scaduta/)
    const preview=await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})
    expect(preview.valid).toBe(true)
    const recipe=await worker.ask<{version:number}>({action:'createAdaptiveLockedRecipe',net,continuity:'G1',locks,bodyId:'worker-qa',selection:picked.selection})
    expect(recipe.version).toBe(8)
    const replay=await worker.ask<{valid:boolean;step:string}>({action:'replayAdaptiveLockedRecipe',step,recipe,bodyId:'worker-qa'})
    expect(replay.valid).toBe(true);expect(replay.step).toBeTruthy()
    // The replay must not replace the active selection.
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).valid).toBe(true)
    await expect(worker.ask({action:'select',face:-1})).rejects.toThrow()
    await expect(worker.ask({action:'prepareCylinder',face:-1})).rejects.toThrow()
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).valid).toBe(true)
    await worker.ask({action:'open',step})
    const again=await worker.ask<typeof picked>({action:'selectAdaptiveExperimental',face:7})
    expect(again.selection.generation).not.toBe(picked.selection.generation)
    await expect(worker.ask({action:'evaluateAdaptiveExperimental',net,continuity:'G1',selection:picked.selection})).rejects.toThrow(/scaduta/)
    expect((await worker.ask<{valid:boolean}>({action:'evaluateAdaptiveExperimental',net:again.net,continuity:'G1',selection:again.selection})).valid).toBe(true)
  } finally {runtime?.dispose();vi.unstubAllGlobals();load.mockRestore();solids.forEach(s=>k.release(s));k.release(imported);editor.dispose()}
},120000)
