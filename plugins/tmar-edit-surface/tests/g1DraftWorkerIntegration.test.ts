// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import type { ShapeHandle } from 'occt-wasm'
import { SurfaceEditorKernel, type DraftAnchor, type FaceInfo, type G1SupportCandidates } from '../editorKernel'
import { boundaryLocked, type Net, type Point } from '../brep'
import { SurfaceDraft } from '../surfaceDraft'
import { SurfaceRuntime } from '../surfaceRuntime'
import type { Request } from '../editor.worker'

/** Only the message transport is local. Draft, queue, dispatcher and OCCT are real. */
it('carries a published plane G1 draft through interior edit, undo/redo, export and a current CAD note witness', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned: ShapeHandle[] = []
  let runtime: SurfaceRuntime | undefined, draft: SurfaceDraft | undefined
  const load = vi.spyOn(SurfaceEditorKernel, 'load').mockResolvedValue(editor)
  const sent: Request[] = []
  const client = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null, onmessageerror: null,
    postMessage(message: Request) {
      // Model the browser's ownership boundary, including immutable draft inputs.
      const copy = structuredClone(message)
      sent.push(copy)
      host.onmessage!({ data: copy } as MessageEvent<Request>)
    },
    terminate() {},
  }
  const host = {
    onmessage: null as ((event: MessageEvent<Request>) => void) | null,
    postMessage(reply: unknown) { client.onmessage?.({ data: structuredClone(reply) } as MessageEvent) },
  }
  const rectangle = (x: number) => {
    const p = [{ x, y: 0, z: 0 }, { x: x + 10, y: 0, z: 0 }, { x: x + 10, y: 10, z: 0 }, { x, y: 10, z: 0 }]
    const edges = p.map((a, i) => k.makeLineEdge(a, p[(i + 1) % 4])); owned.push(...edges)
    const wire = k.makeWire(edges); owned.push(wire)
    const face = k.makeFace(wire); owned.push(face)
    return face
  }
  const settled = async () => vi.waitFor(() => {
    const state = draft!.getSnapshot()
    expect(state.error).toBe('')
    expect(state.net).not.toBeNull()
    expect(state.calculating).toBe(false)
    expect(state.validNet).toBe(state.net)
    expect(state.previewStale).toBe(false)
  }, { timeout: 10000, interval: 20 })
  try {
    const shell = k.sew([rectangle(0), rectangle(10)], 1e-7); owned.push(shell)
    const step = k.exportStep(shell)
    vi.stubGlobal('self', host)
    await import('../editor.worker')
    runtime = new SurfaceRuntime(() => client as unknown as Worker)
    draft = new SurfaceDraft(runtime)
    const opened = await runtime.worker.ask<{ faces: FaceInfo[] }>({ action: 'open', step })
    const face = opened.faces.findIndex(f => !f.reason)
    expect(face).toBeGreaterThanOrEqual(0)
    const net = await runtime.worker.ask<Net>({ action: 'select', face })
    const choices = await runtime.worker.ask<G1SupportCandidates>({ action: 'g1SupportCandidates' })
    expect(choices.candidates).toHaveLength(1)
    const choice = choices.candidates[0]
    const u = choice.side === 'uMin' ? 1 : choice.side === 'uMax' ? net.nu - 2 : Math.floor(net.nu / 2)
    const v = choice.side === 'vMin' ? 1 : choice.side === 'vMax' ? net.nv - 2 : Math.floor(net.nv / 2)
    const strip = u * net.nv + v, base = structuredClone(net)
    base.poles[strip][2] += .2
    draft.install(base, { face, continuity: 'G0', originalNet: net })
    await settled()
    const initialRevision = draft.getSnapshot().preview!.previewRevision!
    await draft.applyPlaneTangency(choice)
    const published = draft.getSnapshot(), publishedRevision = published.preview!.previewRevision!
    expect(published.validNet).toBe(published.net)
    expect(published.net!.poles[strip]).toEqual(net.poles[strip])
    expect(published.planeTangency!.referenceNet).toEqual(published.net)
    expect(publishedRevision).toBeGreaterThan(initialRevision)
    expect(sent.map(r => r.action)).toEqual(['open', 'select', 'g1SupportCandidates', 'evaluate', 'proposeG1PlaneTangency', 'publishG1PlaneTangency'])

    const inner = Math.floor(net.nu / 2) * net.nv + Math.floor(net.nv / 2)
    expect(boundaryLocked(net, inner, 'G1')).toBe(false)
    const picked = await runtime.worker.ask<{ anchor: DraftAnchor; at: Point; normal: Point }>({
      action: 'notePick', point: published.net!.poles[inner], previewRevision: publishedRevision,
    })
    const moved = structuredClone(published.net!)
    moved.poles[inner][2] += .12
    draft.preview(moved)
    expect(draft.getSnapshot().validNet).toBeNull()
    await settled()
    draft.commit()
    const edited = draft.getSnapshot(), editedRevision = edited.preview!.previewRevision!
    const resolved = await runtime.worker.ask<{ at: Point; normal: Point }>({
      action: 'noteResolve', anchor: picked.anchor, previewRevision: editedRevision,
    })
    expect(resolved.at[2]).toBeGreaterThan(picked.at[2] + .001)
    expect(edited.planeTangency).toBe(published.planeTangency)
    for (let i = 0; i < net.poles.length; i++) if (boundaryLocked(net, i, 'G1'))
      expect(edited.net!.poles[i]).toEqual(published.net!.poles[i])

    expect(draft.undo()).toBe(true)
    await settled()
    const undoRevision = draft.getSnapshot().preview!.previewRevision!
    expect(draft.getSnapshot().net).toEqual(published.net)
    expect(undoRevision).toBeGreaterThan(editedRevision)
    expect(await runtime.worker.ask({ action: 'noteResolve', anchor: picked.anchor, previewRevision: undoRevision }))
      .toEqual({ at: picked.at, normal: picked.normal })
    expect(draft.redo()).toBe(true)
    await settled()
    const redoRevision = draft.getSnapshot().preview!.previewRevision!
    expect(draft.getSnapshot().net).toEqual(edited.net)
    expect(redoRevision).toBeGreaterThan(undoRevision)
    expect(await runtime.worker.ask({ action: 'noteResolve', anchor: picked.anchor, previewRevision: redoRevision })).toEqual(resolved)

    const exported = await draft.evaluateForExport()
    expect(exported.valid).toBe(true)
    expect(exported.step).toContain('ISO-10303-21')
    expect(exported.previewRevision).toBeGreaterThan(redoRevision)
    expect(draft.getSnapshot().preview!.previewRevision).toBe(exported.previewRevision)
    expect(draft.getSnapshot().validNet).toBe(draft.getSnapshot().net)
    const evaluationRequests = sent.filter(r => r.action === 'evaluateG1PlaneTangency')
    expect(evaluationRequests).toHaveLength(4)
    expect(evaluationRequests.at(-1)).toMatchObject({ constraintId: published.planeTangency!.constraintId, exportStep: true })
    expect(sent.filter(r => r.action === 'evaluate')).toHaveLength(1)
    await expect(runtime.worker.ask({ action: 'noteResolve', anchor: picked.anchor, previewRevision: redoRevision })).rejects.toThrow('Anteprima')
    expect(await runtime.worker.ask({ action: 'noteResolve', anchor: picked.anchor, previewRevision: exported.previewRevision })).toEqual(resolved)
    const witness = await runtime.worker.ask<{ face: number; faceBrep: string; previewRevision: number; selectionRevision: number }>({
      action: 'finalFaceWitness', previewRevision: exported.previewRevision,
    })
    expect(witness.selectionRevision).toBe(picked.anchor.selectionRevision)
    const final = k.fromBREP(witness.faceBrep), imported = k.importStep(exported.step), faces = k.getSubShapes(imported, 'face')
    try {
      expect(k.isValid(imported)).toBe(true)
      expect(faces).toHaveLength(2)
      const a = k.pointOnSurface(final, picked.anchor.u, picked.anchor.v)
      const b = k.pointOnSurface(faces[witness.face], picked.anchor.u, picked.anchor.v)
      expect(resolved.at).toEqual([a.x, a.y, a.z])
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-8)
    } finally { faces.forEach(f => k.release(f)); k.release(imported); k.release(final) }
    expect(load).toHaveBeenCalledTimes(1)
  } finally {
    draft?.dispose(); runtime?.dispose()
    vi.unstubAllGlobals(); load.mockRestore()
    owned.forEach(handle => k.release(handle)); editor.dispose()
  }
}, 60000)
