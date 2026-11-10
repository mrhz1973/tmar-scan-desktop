// SPDX-License-Identifier: AGPL-3.0-only
import { describe,expect,it,vi } from 'vitest'
import * as THREE from 'three'
import { ZebraLayer } from '../../tmar-zebra/ZebraLayer'
const options={target:'scan' as const,selectedIds:[],orientation:'horizontal' as const,width:3,color:'#5388b1'}
function source(){const g=new THREE.PlaneGeometry(2,2,4,4);g.deleteAttribute('normal');const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({flatShading:true}));return {g,mesh}}
describe('flat reduced-mesh inspection without source changes',()=>{
 it('derives normals only on owned per-triangle display buffers and disposes them',()=>{
  const {g,mesh}=source(),original=g.attributes.position.array.slice(),dispose=vi.spyOn(g,'dispose')
  const layer=new ZebraLayer({bodies:()=>new Map(),scan:()=>mesh,invalidate:()=>{},deriveMissingNormals:true},options)
  layer.tick();const overlay=mesh.children[0] as THREE.Mesh
  expect(overlay.geometry).not.toBe(g);expect(overlay.geometry.index).toBeNull();expect(overlay.geometry.getAttribute('normal')).toBeTruthy()
  expect(g.getAttribute('normal')).toBeUndefined();expect(g.attributes.position.array).toEqual(original)
  const released=vi.spyOn(overlay.geometry,'dispose');layer.dispose();expect(released).toHaveBeenCalledOnce();expect(dispose).not.toHaveBeenCalled()
 })
 it('regenerates owned normals after the source buffers change',()=>{
  const {g,mesh}=source(),layer=new ZebraLayer({bodies:()=>new Map(),scan:()=>mesh,invalidate:()=>{},deriveMissingNormals:true},options)
  layer.tick();const first=mesh.children[0] as THREE.Mesh,released=vi.spyOn(first.geometry,'dispose')
  g.attributes.position.setZ(0,.2);g.attributes.position.needsUpdate=true;layer.tick()
  expect(mesh.children[0]).not.toBe(first);expect(released).toHaveBeenCalledOnce();expect(g.getAttribute('normal')).toBeUndefined();layer.dispose()
 })
 it('does not change the original Zebra behavior without explicit opt-in',()=>{
  const {mesh}=source(),layer=new ZebraLayer({bodies:()=>new Map(),scan:()=>mesh,invalidate:()=>{}},options)
  layer.tick();expect(mesh.children).toHaveLength(0);layer.dispose()
 })
})
