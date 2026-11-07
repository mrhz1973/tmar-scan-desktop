// SPDX-License-Identifier: AGPL-3.0-only
import { OcctKernel, type ShapeHandle } from 'occt-wasm'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { OrthographicCamera } from 'three'
import { expect, it, vi } from 'vitest'
import type { Net, Point } from '../brep'
import { replaceSurface, surfaceTable } from '../brep'
import { rebuildFreeBoundary } from '../freeBoundary'
import { wholeBoundaryIndices } from '../wholeBoundary'
import type { FaceInfo, Preview } from '../editorKernel'
import type { Request } from '../editor.worker'
import { pickSheetEdge } from '../sheetDrag'
import { sheetEdgePaths, withBoundary } from '../sheetExtension'
import { queryVisibleSheetEdge } from '../sheetEdgeVisibilityCad'

const frontZ = .02
function curvedCandidate(paths:Point[][], matches:(point:Point)=>boolean, fraction:number) {
  const edges=paths.flatMap((path,edge)=>path.length===49 && path.every(matches)?[edge]:[])
  expect(edges).toHaveLength(1)
  const edge=edges[0], path=paths[edge], along=fraction*(path.length-1)
  const segment=Math.floor(along), offset=along-segment
  const seed=path[segment].map((value,i)=>value+offset*(path[segment+1][i]-value)) as Point
  return {edge,path,seed,segment}
}
function foldedFaces(k:OcctKernel,own:(shape:ShapeHandle)=>ShapeHandle) {
  const vertex = ([x,y,z]:Point) => ({x,y,z})
  const planar = (corners:Point[]) => {
    const edges = corners.map((p,i) => own(k.makeLineEdge(vertex(p),vertex(corners[(i+1)%corners.length]))))
    return own(k.makeFace(own(k.makeWire(edges))))
  }
  const front = planar([[-2,-2,frontZ],[2,-2,frontZ],[2,2,frontZ],[-2,2,frontZ]])
  const rear = planar([[-2,-2,0],[-2,2,0],[2,2,0],[2,-2,0]])
  const seam = planar([[2,-2,0],[2,2,0],[2,2,frontZ],[2,-2,frontZ]])
  return [front,seam,rear]
}

it('certifies the front free edge of a folded shell independent of candidate order', async()=>{
  const k = await OcctKernel.init(), owned:ShapeHandle[] = []
  const own = (shape:ShapeHandle) => { owned.push(shape); return shape }
  try {
    const [front,seam,rear] = foldedFaces(k,own)
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
      const clipping = {partToWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
        planes:[{normal:[0,0,-1] as Point,constant:.01}],margins:{planeClearanceMm:.001,startGuardMm:.001,
          endpointExtensionMm:.0001,minimumVisibleLengthMm:.003,minimumCrossingCosine:.01}}
      expect(queryVisibleSheetEdge(k,source,[rearRim],[-2,0,5],[0,0,-1],clipping)?.edge).toBe(rearRim.edge)
      expect(queryVisibleSheetEdge(k,source,[frontRim],[-2,0,5],[0,0,-1],clipping)).toBeNull()
      for (const candidates of [[frontRim,rearRim],[rearRim,frontRim]])
        expect(queryVisibleSheetEdge(k,source,candidates,[-2,0,5],[0,0,-1],clipping)?.edge).toBe(rearRim.edge)
      expect(queryVisibleSheetEdge(k,source,[rearRim],[-2,0,5],[0,0,-1])).toBeNull()
      expect(queryVisibleSheetEdge(k,source,[frontRim],[-2,0,5],[0,0,-1])?.edge).toBe(frontRim.edge)
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

it('certifies the curved free edge from the actual D polyline on the qualified STEP',async()=>{
  const k=await OcctKernel.init(), owned:ShapeHandle[]=[]
  try {
    const input=readFileSync(new URL('../evidence/free-boundary/compiled-20261103/moved.step',import.meta.url))
    expect(createHash('sha256').update(input).digest('hex')).toBe('61e1e624a432089e613cc9b744a7c883ccee3cd79ba459f0ef1c5c159419741f')
    const source=k.importStep(input.toString('utf8'))
    owned.push(source)
    const before=k.toBREP(source), paths=sheetEdgePaths(k,source)
    const side=(point:Point)=>Math.abs(point[0]-20)<1e-8
    const path=paths.find(candidate=>candidate.length===49 && candidate.every(side))!
    expect(path).toBeDefined()
    const fraction=path[0][1]<path.at(-1)![1] ? .37 : .63
    const candidate=curvedCandidate(paths,side,fraction)
    const result=queryVisibleSheetEdge(k,source,[candidate],[40,-25,45])
    expect(result?.edge).toBe(candidate.edge)
    const expected=withBoundary(k,source,edges=>{
      const edge=edges[candidate.edge], {first,last}=k.curveParameters(edge)
      return k.curvePointAtParam(edge,first+(last-first)*fraction)
    })
    expect(result?.point).toEqual([expect.closeTo(expected.x,10),expect.closeTo(expected.y,10),expect.closeTo(expected.z,10)])
    const gap=Math.hypot(...result!.point.map((x,i)=>x-candidate.seed[i]))
    expect(gap).toBeGreaterThan(1e-6)
    expect(queryVisibleSheetEdge(k,source,[{...candidate,segment:candidate.segment+3}],[40,-25,45])).toBeNull()
    expect(queryVisibleSheetEdge(k,source,[{...candidate,segment:undefined}],[40,-25,45])).toBeNull()
    expect(k.toBREP(source)).toBe(before)
    console.info('Curved D STEP native point', {gap,point:result!.point,segment:candidate.segment})

    const keep=(shape:ShapeHandle)=>{owned.push(shape);return shape}
    const faces=k.getSubShapes(source,'face');owned.push(...faces)
    const net=surfaceTable(k.toBREP(faces[0])).find(record=>record.net)!.net!
    const edges=(['U0','V1','U1','V0'] as const).map(side=>{
      const ids=wholeBoundaryIndices(net,side), varyV=side==='U0'||side==='U1'
      const knots=varyV?net.kv:net.ku
      return keep(k.makeBSplineEdge(ids.flatMap(i=>net.poles[i]),ids.map(i=>net.weights[i]),
        side==='U1'?knots.map(value=>100+2*value):knots,varyV?net.mv:net.mu,varyV?net.dv:net.du))
    })
    const shifted=keep(k.fixShape(keep(k.makeFaceOnSurface(faces[0],keep(k.makeWire(edges))))))
    expect(k.isValid(shifted)).toBe(true)
    const reparameterized=curvedCandidate(sheetEdgePaths(k,shifted),side,fraction)
    expect(withBoundary(k,shifted,edges=>k.curveParameters(edges[reparameterized.edge]))).toEqual({first:100,last:160})
    const checked=queryVisibleSheetEdge(k,shifted,[reparameterized],[40,-25,45])
    expect(checked?.point).toEqual([expect.closeTo(expected.x,10),expect.closeTo(expected.y,10),expect.closeTo(expected.z,10)])
  } finally { owned.reverse().forEach(shape=>k.release(shape));k[Symbol.dispose]() }
},30000)

it('distinguishes curved free rims separated by 0.02 mm on a folded CAD face',async()=>{
  const k=await OcctKernel.init(), owned:ShapeHandle[]=[]
  const own=(shape:ShapeHandle)=>{owned.push(shape);return shape}
  try {
    const box=own(k.makeBox(20,30,10)), faces=k.getSubShapes(box,'face')
    owned.push(...faces)
    const top=faces.find(face=>{const b=k.uvBounds(face);return Math.abs(k.pointOnSurface(face,(b.uMin+b.uMax)/2,(b.vMin+b.vMax)/2).z-10)<1e-8})!
    const b=k.uvBounds(top), text=k.toBREP(top), record=surfaceTable(text).find(record=>record.kind===1)!
    const net:Net={nu:3,nv:3,du:2,dv:2,ku:[b.uMin,b.uMax],kv:[b.vMin,b.vMax],mu:[3,3],mv:[3,3],rational:[0,0],
      poles:[[-1,-1,0],[-.7,0,0],[-1,1,0],[1,-1,.01],[1.3,0,.01],[1,1,.01],
        [-1,-1,.02],[-.7,0,.02],[-1,1,.02]],weights:Array(9).fill(1)}
    const support=own(k.fromBREP(replaceSurface(text,record,net))), source=own(rebuildFreeBoundary(k,support,net))
    expect(k.isValid(source)).toBe(true)
    const before=k.toBREP(source), paths=sheetEdgePaths(k,source)
    const rim=(z:number)=>curvedCandidate(paths,point=>Math.abs(point[2]-z)<1e-8,.37)
    const front=rim(.02), rear=rim(0)
    for (const candidates of [[rear,front],[front,rear]]) {
      const result=queryVisibleSheetEdge(k,source,candidates,[0,0,1],[0,0,-1])
      expect(result?.edge).toBe(front.edge)
      expect(result?.point[2]).toBeCloseTo(.02,10)
    }
    expect(queryVisibleSheetEdge(k,source,[rear],[0,0,1],[0,0,-1])).toBeNull()
    expect(k.toBREP(source)).toBe(before)
  } finally { owned.reverse().forEach(shape=>k.release(shape));k[Symbol.dispose]() }
},30000)

type WithoutId<T> = T extends { id:number } ? Omit<T,'id'> : never

it('queries the exact worker-owned STEP shell and rejects a stale revision or selection',async()=>{
  vi.resetModules()
  const { SurfaceEditorKernel } = await import('../editorKernel')
  const editor = await SurfaceEditorKernel.load(), k = editor.kernel, owned:ShapeHandle[] = []
  const own = (shape:ShapeHandle) => { owned.push(shape); return shape }
  const load = vi.spyOn(SurfaceEditorKernel,'load').mockResolvedValue(editor)
  let serial = 0
  const waiting = new Map<number,(reply:{result?:unknown;error?:string})=>void>()
  const worker = {
    onmessage:null as ((event:MessageEvent<Request>)=>void)|null,
    postMessage(reply:{id:number;result?:unknown;error?:string}) {
      const receive = waiting.get(reply.id)
      waiting.delete(reply.id)
      receive?.(structuredClone(reply))
    },
  }
  const ask = <T,>(request:WithoutId<Request>) => new Promise<T>((resolve,reject)=>{
    const id = ++serial
    waiting.set(id,reply=>reply.error ? reject(new Error(reply.error)) : resolve(reply.result as T))
    worker.onmessage!({data:structuredClone({...request,id})} as MessageEvent<Request>)
  })
  try {
    const shell = own(k.sew(foldedFaces(k,own),1e-7)), step = k.exportStep(shell)
    vi.stubGlobal('self',worker)
    await import('../editor.worker')
    const opened = await ask<{faces:FaceInfo[];preview:Preview}>({action:'open',step})
    expect(opened.faces.every(face=>face.openSheet)).toBe(true)
    const face = opened.faces.find(item => !item.reason && Array.from(opened.preview.faceMeshes[item.index].positions)
      .every((x,i) => i%3!==2 || Math.abs(x-frontZ)<1e-6))?.index
    expect(face).toBeDefined()
    const selection = {face:face!,refinements:[]}
    const net = await ask<Net>({action:'select',face:selection.face})
    const preview = await ask<Preview>({action:'evaluate',net,continuity:'G1',selection})
    expect(preview.valid).toBe(true)
    const previewRevision = preview.previewRevision!
    const paths = await ask<Point[][]>({action:'sheetEdges',previewRevision})
    const candidates = [0,frontZ].map(z => {
      const edge = paths.findIndex(path=>path.length===2 && path.every(p=>Math.abs(p[0]+2)<1e-8 && Math.abs(p[2]-z)<1e-8))
      expect(edge).toBeGreaterThanOrEqual(0)
      return {edge,path:paths[edge],seed:[-2,0,z] as Point}
    })
    const request = {action:'verifySheetEdgeVisibility' as const,previewRevision,selection,candidates,
      origin:[-2,0,5] as Point,parallelDirection:[0,0,-1] as Point}
    const witness = await ask({action:'finalFaceWitness',previewRevision})
    const expected = {face:selection.face,previewRevision,pick:{edge:candidates[1].edge,
      point:[expect.closeTo(-2,10),expect.closeTo(0,10),expect.closeTo(frontZ,10)]}}
    expect(await ask(request)).toEqual(expected)
    expect(await ask({...request,candidates:[...candidates].reverse()})).toEqual(expected)
    expect(await ask({action:'finalFaceWitness',previewRevision})).toEqual(witness)
    await expect(ask({...request,previewRevision:previewRevision-1})).rejects.toThrow(/Anteprima cambiata/)
    await expect(ask({...request,selection:{...selection,face:(selection.face+1)%3}})).rejects.toThrow(/scaduta/)
    expect(await ask({...request,candidates:[candidates[0]]})).toEqual({face:selection.face,previewRevision,pick:null})
  } finally {
    load.mockRestore()
    vi.unstubAllGlobals()
    owned.reverse().forEach(shape=>k.release(shape))
    editor.dispose()
  }
},30000)
