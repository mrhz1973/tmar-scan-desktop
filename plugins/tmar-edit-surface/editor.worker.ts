// SPDX-License-Identifier: AGPL-3.0-only
import { SurfaceEditorKernel, type DraftAnchor } from './editorKernel'
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import type { Net, Point } from './brep'
import type { StripMove } from './sheetExtension'
import { previewPreparedCylinder } from './cylinderPreview'
import { evaluatePreparedCylinder } from './cylinderEvaluation'
export type Request = { id: number } & (
  { action: 'open'; step: string } | { action: 'select'; face: number }
  | { action: 'sheetEdges'; previewRevision: number }
  | { action: 'duplicateSheetEdge'; previewRevision: number; edge: number; delta: Point; previous?: StripMove[]; path?: Point[] }
  | { action: 'finalFaceWitness'; previewRevision: number }
  | { action: 'notePick'; point: Point; previewRevision: number }
  | { action: 'noteResolve'; anchor: DraftAnchor; previewRevision: number }
  | { action: 'evaluate'; net: Net; continuity: 'G0' | 'G1'; exportStep?: boolean; freeBoundary?: boolean }
  // Experimental display only; this is not an evaluate/Apply result.
  | { action: 'prepareCylinder'; face:number }
  | { action: 'previewCylinder' | 'evaluateCylinder'; session:number; net:Net }
  | { action: 'createRecipe'; net: Net; continuity: 'G0' | 'G1'; lockedPoles: number[]; bodyId: string; freeBoundary?: boolean }
  | { action: 'restoreRecipe' | 'replayRecipe'; step: string; recipe: unknown; bodyId: string }
)
let editor: SurfaceEditorKernel | undefined
let chain = Promise.resolve()
let cylinderSerial=0
let cylinder:{session:number;prepared:{brep:string;net:Net};face:number}|null=null
const resetCylinder=()=>{cylinder=null;cylinderSerial++}
self.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data
  chain = chain.then(async () => {
    try {
      editor ??= await SurfaceEditorKernel.load(wasmUrl)
      let result: unknown
      switch (req.action) {
        case 'open': resetCylinder(); result = editor.open(req.step); break
        case 'select': resetCylinder(); result = editor.select(req.face); break
        case 'sheetEdges': result = editor.sheetEdges(req.previewRevision); break
        case 'duplicateSheetEdge': result = editor.duplicateSheetEdge(req.previewRevision,req.edge,req.delta,req.previous,req.path); break
        case 'finalFaceWitness': result = editor.finalFaceWitness(req.previewRevision); break
        case 'notePick': result = editor.anchorFromPick(req.point,req.previewRevision); break
        case 'noteResolve': result = editor.resolveAnchor(req.anchor,req.previewRevision); break
        case 'evaluate': result = editor.evaluate(req.net, req.continuity, req.exportStep, req.freeBoundary); break
        case 'prepareCylinder': {
          resetCylinder()
          const prepared=editor.prepareCylinderForPreview(req.face)
          cylinder={session:cylinderSerial,prepared,face:req.face}
          result={session:cylinder.session,net:structuredClone(prepared.net)}
          break
        }
        case 'previewCylinder': case 'evaluateCylinder': {
          if(!cylinder || req.session!==cylinder.session) throw new Error('La faccia cilindrica non è più attiva.')
          result=req.action==='previewCylinder'
            ? previewPreparedCylinder(editor.kernel,cylinder.prepared,req.net)
            : evaluatePreparedCylinder(editor.kernel,cylinder.prepared,cylinder.face,req.net)
          break
        }
        case 'createRecipe': result = await editor.createRecipe(req.net, req.continuity, req.lockedPoles, req.bodyId, req.freeBoundary); break
        case 'restoreRecipe': resetCylinder(); result = await editor.restoreRecipe(req.step, req.recipe, req.bodyId); break
        case 'replayRecipe': resetCylinder(); result = await editor.replayRecipe(req.step, req.recipe, req.bodyId); break
        default: throw new Error('Comando Edit Surface non supportato.')
      }
      self.postMessage({ id: req.id, result })
    } catch (e) { self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) }) }
  })
}
