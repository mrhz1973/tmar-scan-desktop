// SPDX-License-Identifier: AGPL-3.0-only
import { SurfaceEditorKernel, type DraftAnchor } from './editorKernel'
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import type { Net, Point } from './brep'
import type { KnotInsertion } from './refineClampedNet'
import type { StripMove } from './sheetExtension'
import { previewPreparedCylinder } from './cylinderPreview'
import { evaluatePreparedCylinder } from './cylinderEvaluation'
import { cylinderAnchorFromPick, resolveCylinderAnchor } from './cylinderNotes'
export type Request = { id: number } & (
  { action: 'open'; step: string } | { action: 'select'; face: number }
  | { action: 'selectRefined'; face: number; refinements: KnotInsertion[] }
  | { action: 'sheetEdges'; previewRevision: number }
  | { action: 'duplicateSheetEdge'; previewRevision: number; edge: number; delta: Point; previous?: StripMove[]; path?: Point[] }
  | { action: 'finalFaceWitness'; previewRevision: number }
  | { action: 'notePick'; point: Point; previewRevision: number }
  | { action: 'noteResolve'; anchor: DraftAnchor; previewRevision: number }
  | { action: 'evaluate'; net: Net; continuity: 'G0' | 'G1'; exportStep?: boolean; freeBoundary?: boolean; selection?: {face:number;refinements:KnotInsertion[]} }
  // Experimental display only; this is not an evaluate/Apply result.
  | { action: 'prepareCylinder'; face:number }
  | { action: 'previewCylinder' | 'evaluateCylinder'; session:number; net:Net }
  | { action: 'cylinderNotePick'; session:number; previewRevision:number; point:Point }
  | { action: 'cylinderNoteResolve'; session:number; previewRevision:number; anchor:DraftAnchor }
  | { action: 'cylinderFaceWitness'; session:number; previewRevision:number }
  | { action: 'createRecipe'; net: Net; continuity: 'G0' | 'G1'; lockedPoles: number[]; bodyId: string; freeBoundary?: boolean; selection?: {face:number;refinements:KnotInsertion[]} }
  | { action: 'restoreRecipe' | 'replayRecipe'; step: string; recipe: unknown; bodyId: string }
)
let editor: SurfaceEditorKernel | undefined
let chain = Promise.resolve()
let cylinderSerial=0
let cylinder:{session:number;prepared:{brep:string;net:Net};face:number;noteFace?:string;noteRevision?:number}|null=null
let cylinderNoteSerial=0
let selectionKey:string|null=null
const resetCylinder=()=>{cylinder=null;cylinderSerial++}
self.onmessage = (event: MessageEvent<Request>) => {
  const req = event.data
  chain = chain.then(async () => {
    try {
      editor ??= await SurfaceEditorKernel.load(wasmUrl)
      let result: unknown
      switch (req.action) {
        case 'open': resetCylinder(); selectionKey=null; result = editor.open(req.step); break
        case 'select': resetCylinder(); selectionKey=null; result = editor.select(req.face); selectionKey=JSON.stringify({face:req.face,refinements:[]}); break
        case 'selectRefined': {
          resetCylinder(); selectionKey=null
          const net=editor.select(req.face,req.refinements), info=editor.infos[req.face]
          selectionKey=JSON.stringify({face:req.face,refinements:req.refinements})
          result={net,trimLocks:info.trimLocks,hiddenPoles:info.hiddenPoles}
          break
        }
        case 'sheetEdges': result = editor.sheetEdges(req.previewRevision); break
        case 'duplicateSheetEdge': result = editor.duplicateSheetEdge(req.previewRevision,req.edge,req.delta,req.previous,req.path); break
        case 'finalFaceWitness': result = editor.finalFaceWitness(req.previewRevision); break
        case 'notePick': result = editor.anchorFromPick(req.point,req.previewRevision); break
        case 'noteResolve': result = editor.resolveAnchor(req.anchor,req.previewRevision); break
        case 'evaluate': {
          if(req.selection && selectionKey!==JSON.stringify(req.selection)) {
            selectionKey=null; editor.select(req.selection.face,req.selection.refinements); selectionKey=JSON.stringify(req.selection)
          }
          result = editor.evaluate(req.net, req.continuity, req.exportStep, req.freeBoundary); break
        }
        case 'prepareCylinder': {
          resetCylinder(); selectionKey=null
          const prepared=editor.prepareCylinderForPreview(req.face)
          cylinder={session:cylinderSerial,prepared,face:req.face}
          result={session:cylinder.session,net:structuredClone(prepared.net)}
          break
        }
        case 'previewCylinder': case 'evaluateCylinder': {
          if(!cylinder || req.session!==cylinder.session) throw new Error('La faccia cilindrica non è più attiva.')
          cylinder.noteFace=undefined;cylinder.noteRevision=undefined
          if(req.action==='previewCylinder') result=previewPreparedCylinder(editor.kernel,cylinder.prepared,req.net)
          else {
            const evaluated=evaluatePreparedCylinder(editor.kernel,cylinder.prepared,cylinder.face,req.net)
            cylinder.noteFace=evaluated.faceBrep;cylinder.noteRevision=++cylinderNoteSerial
            result={mesh:evaluated.mesh,step:evaluated.step,previewRevision:cylinder.noteRevision}
          }
          break
        }
        case 'cylinderNotePick': case 'cylinderNoteResolve': case 'cylinderFaceWitness': {
          if(!cylinder || req.session!==cylinder.session || !cylinder.noteFace || req.previewRevision!==cylinder.noteRevision)
            throw new Error('Anteprima cilindrica cambiata: verifica di nuovo la faccia.')
          if(req.action==='cylinderNotePick') result=cylinderAnchorFromPick(editor.kernel,cylinder.noteFace,cylinder.face,cylinder.session,req.point)
          else if(req.action==='cylinderNoteResolve') result=resolveCylinderAnchor(editor.kernel,cylinder.noteFace,cylinder.face,cylinder.session,req.anchor)
          else result={face:cylinder.face,selectionRevision:cylinder.session,previewRevision:cylinder.noteRevision,faceBrep:cylinder.noteFace}
          break
        }
        case 'createRecipe': {
          if(req.selection && selectionKey!==JSON.stringify(req.selection)) {
            selectionKey=null; editor.select(req.selection.face,req.selection.refinements); selectionKey=JSON.stringify(req.selection)
          }
          result = await editor.createRecipe(req.net, req.continuity, req.lockedPoles, req.bodyId, req.freeBoundary); break
        }
        case 'restoreRecipe': resetCylinder(); selectionKey=null; result = await editor.restoreRecipe(req.step, req.recipe, req.bodyId); break
        case 'replayRecipe': resetCylinder(); selectionKey=null; result = await editor.replayRecipe(req.step, req.recipe, req.bodyId); break
        default: throw new Error('Comando Edit Surface non supportato.')
      }
      self.postMessage({ id: req.id, result })
    } catch (e) { self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) }) }
  })
}
