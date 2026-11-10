// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { expect, it } from 'vitest'
import type { Net } from '../brep'
import { netCells, netEdges } from '../netSelection'
import { pickNetAt } from '../netPicking'
import { localFrame } from '../localFrame'

const n: Net = { nu:3,nv:2,du:1,dv:1,periodic:[1,0],
  poles:[[-1,-1,0],[0,-1,0],[0,0,0],[1,0,0],[-1,1,0],[0,1,0]],
  weights:[1,1,1,1,1,1],rational:[0,0],ku:[0,1],kv:[0,1],mu:[2,2],mv:[2,2] }

it('connects the periodic seam without duplicating two-pole edges or nonperiodic cells',()=>{
  expect(netEdges(n)).toContainEqual([4,0]);expect(netEdges(n)).toContainEqual([5,1])
  expect(netCells(n)).toContainEqual([4,0,1,5])
  expect(netEdges({...n,periodic:[0,0]})).not.toContainEqual([4,0])
  expect(netCells({...n,periodic:[0,0]})).not.toContainEqual([4,0,1,5])
  const both={...n,periodic:[1,1] as [number,number]}
  expect(netEdges(both)).toHaveLength(9)
  expect(netCells(both)).toHaveLength(3)
})

it('selects the wrapped edge and cell and respects hidden seam poles',()=>{
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,0.1,100)
  camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
  const rect={left:0,top:0,width:400,height:400},partWorld=new THREE.Matrix4()
  const hit=(x:number,y:number,mode:'edges'|'cells',hiddenPoles:number[]=[])=>
    pickNetAt({net:n,mode,hiddenPoles,camera,partWorld,rect,clientX:(x/2+1)*200,clientY:(1-y/2)*200})
  expect(hit(-1,0,'edges')).toEqual([4,0])
  expect(hit(-0.75,0,'cells')).toEqual([4,0,1,5])
  expect(hit(-1,0,'edges',[0])).toBeNull()
  expect(hit(-0.75,0,'cells',[0])).toBeNull()
  expect(pickNetAt({net:{...n,periodic:[1,1]},mode:'cells',hiddenPoles:[],camera,partWorld,rect,clientX:125,clientY:200})).toBeNull()
  expect(localFrame(n,0)).toBeNull()
})
