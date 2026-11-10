// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { assertNet, replaceSurface, surfaceTable } from '../brep'

it('round-trips a periodic cylindrical support without enabling unsafe editing', async () => {
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel
  const cylinder = k.makeCylinder(10, 20), source = k.importStep(k.exportStep(cylinder))
  const converted = k.generalTransform(source, [1,0,0,0, 0,1,0,0, 0,0,1,0])
  let restored: ReturnType<typeof k.fromBREP> | undefined
  try {
    const brep = k.toBREP(converted), record = surfaceTable(brep).find(r => r.periodicNet)
    expect(record?.net).toBeUndefined()
    expect(record?.periodicNet?.periodic).toEqual([1, 0])
    const net = record!.periodicNet!
    expect(() => assertNet(net, net, 'G0')).toThrow(/periodici/)
    const restoredText = replaceSurface(brep, record!, net)
    const restoredRecord = surfaceTable(restoredText).find(r => r.periodicNet)
    expect(restoredRecord?.periodicNet).toEqual(net)
    restored = k.fromBREP(restoredText)
    expect(k.isValid(restored)).toBe(true)
    expect(k.getVolume(restored)).toBeCloseTo(k.getVolume(converted), 6)

    const before = k.getSubShapes(converted, 'face'), after = k.getSubShapes(restored, 'face')
    const solids = k.getSubShapes(restored, 'solid')
    try {
      expect(after.length).toBe(before.length)
      expect(solids.length).toBe(1)
      for (let f = 0; f < before.length; f++) {
        expect(k.surfaceType(after[f])).toBe(k.surfaceType(before[f]))
        const b = k.uvBounds(before[f])
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
          const u = b.uMin + (b.uMax-b.uMin)*i/8, v = b.vMin + (b.vMax-b.vMin)*j/8
          const p = k.pointOnSurface(before[f],u,v), q = k.pointOnSurface(after[f],u,v)
          expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-8)
          if (i>0 && i<8 && j>0 && j<8) expect(k.classifyPointOnFace(after[f],u,v)).toBe(k.classifyPointOnFace(before[f],u,v))
        }
      }
      const tolerances = (shape: typeof converted, kind: string) => Array.from(k.toBREP(shape).matchAll(new RegExp(`^${kind}\\s*\\n\\s*([\\deE+.-]+)`, 'gm')), m => Number(m[1]))
      for (const kind of ['Ed','Ve']) expect(tolerances(restored,kind)).toEqual(tolerances(converted,kind))
      const opened = editor.open(k.exportStep(restored))
      expect(opened.faces.some(f => f.reason?.includes('non periodiche'))).toBe(true)
    } finally { [...before, ...after, ...solids].forEach(h => k.release(h)) }
  } finally {
    if (restored) k.release(restored)
    k.release(converted); k.release(source); k.release(cylinder); editor.dispose()
  }
}, 60000)
