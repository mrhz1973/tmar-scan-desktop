// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { pickSheetEdge } from '../sheetDrag'
import type { Point } from '../brep'

describe('free-edge picking', () => {
  const rect={left:0,top:0,width:800,height:600} as DOMRect
  const camera=new PerspectiveCamera(40,rect.width/rect.height,0.1,1000)
  camera.position.set(40,-50,60);camera.up.set(0,0,1);camera.lookAt(10,15,10);camera.updateMatrixWorld()
  const pixel=(p:Vector3)=>{const q=p.clone().project(camera);return[(q.x+1)*rect.width/2,(1-q.y)*rect.height/2]}
  const paths:Point[][]=[[[20,0,10],[20,30,10]],[[20.1,0,10],[20.1,30,10]]]

  it('anchors a selected perspective edge at the actual point on the 3D segment', () => {
    const target=new Vector3(20,15,10),[x,y]=pixel(target)
    const hit=pickSheetEdge(paths,camera,rect,x,y)
    expect(hit?.edge).toBe(0)
    expect(hit!.anchor.distanceTo(target)).toBeLessThan(1e-8)
  })
  it('keeps the selected edge when a neighbouring edge is closer to the pointer', () => {
    const [x,y]=pixel(new Vector3(20.1,15,10))
    expect(pickSheetEdge(paths,camera,rect,x,y)?.edge).toBe(1)
    const hit=pickSheetEdge(paths,camera,rect,x,y,0,Infinity)
    expect(hit?.edge).toBe(0)
    expect(hit!.anchor.x).toBeCloseTo(20,12)
  })
})
