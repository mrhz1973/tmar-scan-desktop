// SPDX-License-Identifier: AGPL-3.0-only
import type { ShapeHandle } from 'occt-wasm'
import { expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import type { Preview } from '../editorKernel'
import type { Request } from '../editor.worker'
import { SurfaceRuntime } from '../surfaceRuntime'

it('duplicates the validated face of an imported STEP solid without changing its live CAD preview', async () => {
  vi.resetModules()
  const { SurfaceEditorKernel, orientedSurfaceNormal } = await import('../editorKernel')
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const detachedEditor = new SurfaceEditorKernel(k)
  const owned: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { owned.push(shape); return shape }
  const facesOf = (shape: ShapeHandle) => {
    const faces = k.getSubShapes(shape, 'face')
    owned.push(...faces)
    return faces
  }
  const load = vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let runtime: SurfaceRuntime | undefined
  try {
    const box = keep(k.makeBox(20,30,10)), step = k.exportStep(box)
    const original = keep(k.importStep(step)), originalFaces = facesOf(original)
    const face = originalFaces.findIndex(item => k.shapeOrientation(item) === 'reversed')
    expect(face).toBeGreaterThanOrEqual(0)
    const initial = originalFaces[face], bounds = k.uvBounds(initial)
    const u = (bounds.uMin+bounds.uMax)/2, v = (bounds.vMin+bounds.vMax)/2
    const normal = orientedSurfaceNormal(k, initial, u, v)

    const client = {onmessage:null as ((e:MessageEvent)=>void)|null,onerror:null,onmessageerror:null,
      postMessage(message:Request) { host.onmessage!({data:structuredClone(message)} as MessageEvent<Request>) },terminate() {}}
    const host = {onmessage:null as ((e:MessageEvent<Request>)=>void)|null,
      postMessage(reply:unknown) { client.onmessage?.({data:structuredClone(reply)} as MessageEvent) }}
    vi.stubGlobal('self',host)
    await import('../editor.worker')
    runtime = new SurfaceRuntime(() => client as unknown as Worker)
    const ask = runtime.worker.ask.bind(runtime.worker)
    await ask({action:'open',step})
    const sourceHandle = (editor as unknown as {source:ShapeHandle}).source
    const sourceBrep = k.toBREP(sourceHandle)
    const selection = {face,refinements:[]}
    const net = await ask<Net>({action:'select',face})
    const before = await ask<Preview>({action:'evaluate',net,continuity:'G1',selection})
    const moved = structuredClone(net)
    moved.poles[12] = net.poles[12].map((x,i) => x + .2*normal[i]) as Point
    const preview = await ask<Preview>({action:'evaluate',net:moved,continuity:'G1',selection})
    const request = {action:'duplicateCadFace' as const,selection,previewRevision:preview.previewRevision!}
    const witness = await ask<{faceBrep:string;selectionRevision:number}>({action:'finalFaceWitness',previewRevision:request.previewRevision})
    await expect(ask({...request,previewRevision:before.previewRevision!})).rejects.toThrow(/Anteprima cambiata/)
    await expect(ask({...request,selection:{face:(face+1)%originalFaces.length,refinements:[]}})).rejects.toThrow(/scaduta/)
    const duplicated = await ask<{face:number;previewRevision:number;selectionRevision:number;step:string}>(request)
    expect(duplicated).toMatchObject({face,previewRevision:request.previewRevision,selectionRevision:witness.selectionRevision})
    expect(duplicated).not.toHaveProperty('mesh')
    expect(await ask({action:'finalFaceWitness',previewRevision:request.previewRevision})).toEqual(witness)
    expect(k.toBREP(sourceHandle)).toBe(sourceBrep)

    const copy = keep(k.importStep(duplicated.step)), copyFaces = facesOf(copy), current = keep(k.fromBREP(witness.faceBrep))
    expect(k.isValid(copy)).toBe(true)
    expect(k.subShapeCount(copy,'solid')).toBe(0)
    expect(copyFaces).toHaveLength(1)
    const detached = copyFaces[0]
    expect(k.shapeOrientation(detached)).toBe('reversed')
    expect(k.uvBounds(detached)).toEqual(k.uvBounds(current))
    expect(k.subShapeCount(detached,'wire')).toBe(1)
    expect(k.subShapeCount(detached,'edge')).toBe(4)
    const delta = (a:{x:number;y:number;z:number}, b:{x:number;y:number;z:number}) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
    let maxDeviation = 0
    for (let i=0;i<=8;i++) for (let j=0;j<=8;j++) {
      const a = bounds.uMin + (bounds.uMax-bounds.uMin)*i/8, b = bounds.vMin + (bounds.vMax-bounds.vMin)*j/8
      maxDeviation = Math.max(maxDeviation,delta(k.pointOnSurface(detached,a,b),k.pointOnSurface(current,a,b)))
    }
    expect(maxDeviation).toBeLessThan(1e-8)
    expect(delta(k.pointOnSurface(detached,u,v),k.pointOnSurface(initial,u,v))).toBeGreaterThan(.01)
    const opened = detachedEditor.open(duplicated.step)
    expect(opened.faces).toHaveLength(1)
    expect(opened.faces[0]).toMatchObject({reason:null,openSheet:true,freeBoundary:true})
    const reopenedNet = detachedEditor.select(0)
    const editedAgain = structuredClone(reopenedNet)
    editedAgain.poles[12] = reopenedNet.poles[12].map((x,i) => x + .1*normal[i]) as Point
    const reedit = detachedEditor.evaluate(editedAgain,'G1',true)
    expect(reedit.valid).toBe(true)
    const reedited = keep(k.importStep(reedit.step!)), reeditedFace = facesOf(reedited)[0]
    const reeditDisplacement = delta(k.pointOnSurface(detached,u,v),k.pointOnSurface(reeditedFace,u,v))
    expect(reeditDisplacement).toBeGreaterThan(.01)
    expect(k.toBREP(sourceHandle)).toBe(sourceBrep)
    console.info('Duplicate face STEP roundtrip', { maxDeviation, reeditDisplacement })
  } finally {
    runtime?.dispose()
    detachedEditor.dispose()
    load.mockRestore()
    vi.unstubAllGlobals()
    owned.reverse().forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)

it('refuses to detach a face with an internal trim under the natural-face contract', async () => {
  const { SurfaceEditorKernel } = await import('../editorKernel')
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const box = k.makeBox(48,48,10), cylinder = k.makeCylinder(3,14)
  const tool = k.translate(cylinder,12,12,-2), drilled = k.cut(box,tool)
  try {
    const { faces } = editor.open(k.exportStep(drilled))
    const trimmed = faces.find(face => !face.reason && face.trimLocks.length > 0)!
    expect(trimmed).toBeDefined()
    const net = editor.select(trimmed.index), preview = editor.evaluate(net,'G1')
    const witness = editor.finalFaceWitness(preview.previewRevision!)
    expect(() => editor.duplicateCadFace(preview.previewRevision!)).toThrow(/faccia naturale/)
    expect(editor.finalFaceWitness(preview.previewRevision!)).toEqual(witness)
  } finally {
    ;[drilled,tool,cylinder,box].forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)
