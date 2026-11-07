// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { OrthographicCamera } from 'three'
import { expect, it } from 'vitest'
import type { Point } from '../brep'
import { pickSheetEdge } from '../sheetDrag'
import { sheetEdgePaths } from '../sheetExtension'
import { queryVisibleSheetEdge } from '../sheetEdgeVisibilityCad'

it('certifies the front free edge of a folded shell independent of candidate order', async()=>{
  const k = await OcctKernel.init(), owned:ShapeHandle[] = []
  const own = (shape:ShapeHandle) => { owned.push(shape); return shape }
  const vertex = ([x,y,z]:Point) => ({x,y,z})
  const planar = (corners:Point[]) => {
    const edges = corners.map((p,i) => own(k.makeLineEdge(vertex(p),vertex(corners[(i+1)%corners.length]))))
    return own(k.makeFace(own(k.makeWire(edges))))
  }
  try {
    const frontZ = .02
    const front = planar([[-2,-2,frontZ],[2,-2,frontZ],[2,2,frontZ],[-2,2,frontZ]])
    const rear = planar([[-2,-2,0],[-2,2,0],[2,2,0],[2,-2,0]])
    const seam = planar([[2,-2,0],[2,2,0],[2,2,frontZ],[2,-2,frontZ]])
    const camera = new OrthographicCamera(-3,3,3,-3,.01,100)
    camera.position.set(-2,0,5)
    camera.lookAt(-2,0,0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const rect = {left:0,top:0,width:600,height:600} as DOMRect
    for (const faces of [[front,seam,rear],[rear,seam,front]]) {
      const sewn = own(k.sew(faces,1e-7)), source = own(k.importStep(k.exportStep(sewn)))
      expect(k.getShapeType(source)).toBe('shell')
      expect(k.isValid(source)).toBe(true)
      expect(k.subShapeCount(source,'face')).toBe(3)
      const sourceBrep = k.toBREP(source), paths = sheetEdgePaths(k,source)
      const at = (seed:Point,match:(point:Point)=>boolean) => {
        const indices = paths.flatMap((path,i) => path.length===2 && path.every(match) ? [i] : [])
        expect(indices).toHaveLength(1)
        return {edge:indices[0],path:paths[indices[0]],seed}
      }
      const rim = (z:number) => at([-2,0,z],p => Math.abs(p[0]+2)<1e-8 && Math.abs(p[2]-z)<1e-8)
      const frontRim = rim(frontZ), rearRim = rim(0)
      expect(frontRim.edge).not.toBe(rearRim.edge)
      for (const candidates of [[frontRim,rearRim],[rearRim,frontRim]]) {
        const screenPaths = candidates.map(({seed:[x,,z]}):Point[]=>[[x,-2,z],[x,2,z]])
        const screenPick = pickSheetEdge(screenPaths,camera,rect,300,300)
        expect(screenPick?.anchor.z).toBeCloseTo(candidates[0].seed[2],10)
        const cadPick = queryVisibleSheetEdge(k,source,candidates,[-2,0,5],[0,0,-1])
        expect(cadPick?.edge).toBe(frontRim.edge)
        expect(cadPick?.point[2]).toBeCloseTo(frontZ,10)
      }
      expect(queryVisibleSheetEdge(k,source,[rearRim],[-2,0,5],[0,0,-1])).toBeNull()
      const anotherFront = at([0,-2,frontZ],p=>Math.abs(p[1]+2)<1e-8 && Math.abs(p[2]-frontZ)<1e-8)
      expect(queryVisibleSheetEdge(k,source,[frontRim,anotherFront],[-2,0,5],[0,0,-1])).toBeNull()
      expect(queryVisibleSheetEdge(k,source,[frontRim,{...rearRim,path:frontRim.path}],[-2,0,5],[0,0,-1])).toBeNull()
      expect(k.toBREP(source)).toBe(sourceBrep)
    }
  } finally {
    owned.reverse().forEach(shape=>k.release(shape))
    k[Symbol.dispose]()
  }
},30000)
