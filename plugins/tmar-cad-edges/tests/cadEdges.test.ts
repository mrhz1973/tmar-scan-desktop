// SPDX-License-Identifier: AGPL-3.0-only
import { describe,expect,it,vi } from 'vitest'
import * as THREE from 'three'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { DEFAULT_EDGES,normalizeEdges } from '../edgePrefs'
import { ReferenceEdges } from '../ReferenceEdges'
import { ZebraLayer } from '../../tmar-zebra/ZebraLayer'

describe('CAD edge preferences',()=>{
  it('uses safe defaults for unavailable settings',()=>expect(normalizeEdges(null)).toEqual(DEFAULT_EDGES))
  it('bounds finite pixel widths and validates a color',()=>{
    expect(normalizeEdges({width:99,color:'#ff1234',enabled:false})).toEqual({width:6,color:'#ff1234',enabled:false})
    expect(normalizeEdges({width:-1,color:'not-a-color'})).toEqual({...DEFAULT_EDGES,width:1})
    expect(normalizeEdges({width:NaN})).toEqual(DEFAULT_EDGES)
  })
})
function fixture(){
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,100)
  camera.position.set(0,0,10);camera.lookAt(0,0,0)
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshStandardMaterial())
  scene.add(mesh)
  const edges=new Float32Array([-1,-1,0,1,-1,0,1,-1,0,1,1,0,1,1,0,-1,1,0,-1,1,0,-1,-1,0])
  let source:{mesh:THREE.Mesh;cadEdges:Float32Array|null}|null={mesh,cadEdges:edges}
  const host={referenceDisplay:()=>source,layerHost:()=>({scene,camera:()=>camera})} as unknown as SceneManager
  return{scene,camera,mesh,edges,layer:new ReferenceEdges(host),setSource:(s:typeof source)=>{source=s}}
}
describe('borrowed STEP edge display lifecycle',()=>{
  it('draws provided boundaries only and changes style without touching source',()=>{
    const f=fixture(),dispose=vi.spyOn(f.mesh.geometry,'dispose'),old=f.mesh.geometry.attributes.position.array.slice()
    f.layer.tick(DEFAULT_EDGES,true,1000,600)
    expect(f.layer.group.children.find(l=>l.name==='tmar-step-face-boundaries')).toBeTruthy()
    expect(f.layer.group.visible).toBe(true)
    f.layer.tick({...DEFAULT_EDGES,width:5,color:'#ff1234'},true,1000,600)
    const line=f.layer.group.children[0] as THREE.Mesh
    expect((line.material as unknown as {linewidth:number}).linewidth).toBe(5)
    expect(f.mesh.geometry.attributes.position.array).toEqual(old)
    f.layer.dispose();f.layer.dispose();expect(dispose).not.toHaveBeenCalled();expect(f.layer.group.parent).toBe(null)
  })
  it('never invents topology for a mesh reference or retains a replaced layer',()=>{
    const f=fixture();f.layer.tick(DEFAULT_EDGES,true,100,100)
    f.setSource({mesh:f.mesh,cadEdges:null});f.layer.tick(DEFAULT_EDGES,true,100,100)
    expect(f.layer.group.visible).toBe(false);expect(f.layer.group.children).toHaveLength(0)
    f.setSource(null);f.layer.tick(DEFAULT_EDGES,true,100,100);expect(f.layer.group.visible).toBe(false);f.layer.dispose()
  })
  it('honors workspace/source visibility and original clipping',()=>{
    const f=fixture();f.mesh.material.clippingPlanes=[new THREE.Plane(new THREE.Vector3(1,0,0),0)]
    f.layer.tick(DEFAULT_EDGES,true,100,100)
    const mat=(f.layer.group.children[0] as THREE.Mesh).material as THREE.Material
    expect(mat.clippingPlanes).toBe(f.mesh.material.clippingPlanes);expect(mat.depthTest).toBe(true)
    f.layer.tick(DEFAULT_EDGES,false,100,100);expect(f.layer.group.visible).toBe(false)
    f.mesh.visible=false;f.layer.tick(DEFAULT_EDGES,true,100,100);expect(f.layer.group.visible).toBe(false);f.layer.dispose()
  })
  it('keeps reference lines in the datum frame, not the aligned scan frame',()=>{
    const f=fixture();f.mesh.position.set(10,20,30);f.layer.tick(DEFAULT_EDGES,true,100,100)
    expect(f.layer.group.matrix.elements).toEqual(f.mesh.matrixWorld.elements);f.layer.dispose()
  })
})
describe('Zebra CAD depth contract',()=>{
  it('places CAD/ref fill behind native edges but before original faces',()=>{
    const f=fixture();f.mesh.material.polygonOffset=true;f.mesh.material.polygonOffsetFactor=1;f.mesh.material.polygonOffsetUnits=1
    const zebra=new ZebraLayer({bodies:()=>new Map([[1,f.mesh]]),scan:()=>null,invalidate:()=>{}},{target:'visible',selectedIds:[],orientation:'horizontal',width:3,color:'#5388b1'})
    zebra.tick();const material=(f.mesh.children.find(c=>c.name==='tmar-zebra-overlay') as THREE.Mesh).material as THREE.Material
    expect(material.polygonOffsetFactor).toBe(.5);expect(material.depthTest).toBe(true);expect(material.depthWrite).toBe(true)
    expect(f.mesh.material.polygonOffsetFactor).toBe(1);zebra.dispose();f.layer.dispose()
  })
})
