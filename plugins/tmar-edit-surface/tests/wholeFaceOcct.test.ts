// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto'
import type { ShapeHandle } from 'occt-wasm'
import { expect, it, vi } from 'vitest'
import type { Point } from '../brep'
import type { Request } from '../editor.worker'
import { SurfaceRuntime } from '../surfaceRuntime'
import { createWorkspaceSurfaceSession, type WorkspaceSurfaceSession } from '../workspaceSession'

it('translates a whole open face through the CAD dispatcher and preserves its STEP rim', async () => {
  vi.resetModules()
  const { SurfaceEditorKernel } = await import('../editorKernel')
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const owned: ShapeHandle[] = []
  const keep = (shape: ShapeHandle) => { owned.push(shape); return shape }
  const facesOf = (shape: ShapeHandle) => {
    const faces = k.getSubShapes(shape, 'face')
    owned.push(...faces)
    return faces
  }
  let session: WorkspaceSurfaceSession | undefined
  const load = vi.spyOn(SurfaceEditorKernel, 'load').mockResolvedValue(editor)
  try {
    const box = keep(k.makeBox(20, 30, 10))
    editor.open(k.exportStep(facesOf(box)[5]))
    const curved = structuredClone(editor.select(0))
    const center = Math.floor(curved.nu / 2) * curved.nv + Math.floor(curved.nv / 2)
    curved.poles[center][2] += .4
    const sourceStep = editor.evaluate(curved, 'G1', true).step!
    const source = keep(k.importStep(sourceStep)), originalFace = facesOf(source)[0]
    const originalBrep = k.toBREP(source)
    expect(k.isValid(source)).toBe(true)

    const client = { onmessage: null as ((e: MessageEvent) => void) | null, onerror: null, onmessageerror: null,
      postMessage(message: Request) { host.onmessage!({ data: structuredClone(message) } as MessageEvent<Request>) }, terminate() {} }
    const host = { onmessage: null as ((e: MessageEvent<Request>) => void) | null,
      postMessage(reply: unknown) { client.onmessage?.({ data: structuredClone(reply) } as MessageEvent) } }
    vi.stubGlobal('self', host)
    await import('../editor.worker')
    const runtime = new SurfaceRuntime(() => client as unknown as Worker)
    const bytes = new TextEncoder().encode(sourceStep), sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
    const context = { apiVersion:1, sessionId:'whole-face-qa', step:bytes, signal:new AbortController().signal,
      source:{ documentEpoch:'synthetic', sourceEpoch:1, bodyId:1, bodyKey:'sheet', buildVersion:1, kernelGeneration:1,
        frameRevision:1, stepSha256:sha(bytes), units:'mm', coordinateFrame:'part' },
      capabilities:{ apiVersion:1, enabled:true, commitKinds:['cad-copy'] },
      assertSourceCurrent:() => {}, own:(fn:() => void) => fn, reportFatal:vi.fn() }
    session = await createWorkspaceSurfaceSession(context as never, vi.fn() as never, { runtime, sha256:async b => sha(b) })
    const ready = () => vi.waitFor(() => expect(session!.getSnapshot().validation.kind).toBe('valid'), { timeout:10000, interval:20 })
    await session.chooseFace(0)
    await ready()
    session.setFreeBoundary(true)
    await ready()
    const before = session.getPanelState().net!, history = session.getSnapshot().historyRevision
    const delta: Point = [.25, -.5, .125]
    const moved = before.poles.map(([x,y,z]): Point => [x + delta[0], y + delta[1], z + delta[2]])
    session.setDragMode('axis')
    session.setWholeFaceDrag(true)
    expect(session.beginWholeFaceGesture(before)).toBe(true)
    session.finishPoleGesture(moved)
    await ready()
    expect(session.getSnapshot().historyRevision).toBe(history + 1)
    expect(session.getPanelState().net).toEqual({ ...before, poles:moved })

    const { step } = await session.exportStep()
    const edited = keep(k.importStep(step)), resultFaces = facesOf(edited)
    expect(k.isValid(edited)).toBe(true)
    expect(resultFaces).toHaveLength(1)
    expect(k.subShapeCount(edited, 'solid')).toBe(0)
    const result = resultFaces[0], uv = k.uvBounds(originalFace)
    expect(k.getSurfaceArea(result)).toBeCloseTo(k.getSurfaceArea(originalFace), 7)
    let maxSurfaceError = 0
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const u = uv.uMin + (uv.uMax - uv.uMin) * i / 8, v = uv.vMin + (uv.vMax - uv.vMin) * j / 8
      const a = k.pointOnSurface(originalFace, u, v), b = k.pointOnSurface(result, u, v)
      maxSurfaceError = Math.max(maxSurfaceError, Math.hypot(b.x-a.x-delta[0], b.y-a.y-delta[1], b.z-a.z-delta[2]))
    }
    const rimGap = (from: ShapeHandle, to: ShapeHandle, sign: number) => {
      const edges = k.getSubShapes(from, 'edge'), wire = keep(k.outerWire(to))
      owned.push(...edges)
      expect(edges).toHaveLength(4)
      return Math.max(...edges.flatMap(edge => {
        const { first, last } = k.curveParameters(edge)
        return Array.from({length:9}, (_, i) => {
          const p = k.curvePointAtParam(edge, first + (last - first) * i / 8)
          const vertex = k.makeVertex(p.x + sign*delta[0], p.y + sign*delta[1], p.z + sign*delta[2])
          try { return k.distanceBetween(vertex, wire) }
          finally { k.release(vertex) }
        })
      }))
    }
    const maxRimGap = Math.max(rimGap(originalFace, result, 1), rimGap(result, originalFace, -1))
    expect(maxSurfaceError).toBeLessThan(1e-7)
    expect(maxRimGap).toBeLessThan(1e-7)
    console.info('Whole-face STEP translation', { maxSurfaceError, maxRimGap })
    session.undo()
    await ready()
    expect(session.getPanelState().net).toEqual(before)
    expect(k.toBREP(source)).toBe(originalBrep)
  } finally {
    if (session) await session.dispose('cancelled')
    load.mockRestore()
    vi.unstubAllGlobals()
    owned.reverse().forEach(shape => k.release(shape))
    editor.dispose()
  }
}, 30000)
