// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrthoNavigator } from '../src/viewer/orthoNav'
import { SCHEMES, type ControlScheme } from '../src/viewer/navSchemes'
function setup(scheme: ControlScheme, painting: boolean) {
  const listeners:Record<string, ((e: unknown)=>void)[]> = {}
  const add = (type:string,listener:(e:unknown)=>void) => { (listeners[type]??=[]).push(listener) }
  vi.stubGlobal('document',{addEventListener:add,removeEventListener:()=>{}})
  const canvas={addEventListener:add,removeEventListener:()=>{},clientHeight:600,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})} as unknown as HTMLCanvasElement
  const camera=new THREE.OrthographicCamera(-4/3,4/3,1,-1,.01,100)
  camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  const controls={target:new THREE.Vector3(),update:()=>{}} as unknown as OrbitControls
  const nav=new OrthoNavigator(camera,controls,canvas,()=>[],{center:new THREE.Vector3(),radius:1})
  nav.setScheme(scheme);nav.setPaintMode(painting)
  const fire=(type:string,e:Partial<PointerEvent>)=>(listeners[type]??[]).forEach(l=>l({pointerType:'mouse',shiftKey:false,ctrlKey:false,altKey:false,preventDefault:()=>{},...e}))
  return{nav,fire,pose:()=>[...camera.position.toArray(),...camera.up.toArray(),...controls.target.toArray(),camera.zoom]}
}
afterEach(()=>vi.unstubAllGlobals())
describe('Shift is the normal left/right navigation while marking',()=>{
 for(const scheme of SCHEMES)it(`matches Navigate for ${scheme.id}`,()=>{
  for(const buttons of [1,2]){
   const run=(painting:boolean)=>{const f=setup(scheme,painting);f.fire('pointerdown',{buttons,shiftKey:painting,clientX:400,clientY:300});f.fire('pointermove',{buttons,shiftKey:painting,clientX:430,clientY:320});f.fire('pointerup',{buttons:0,shiftKey:painting,clientX:430,clientY:320});const p=f.pose();f.nav.dispose();return p}
   const plain=run(false),shift=run(true);shift.forEach((v,i)=>expect(v).toBeCloseTo(plain[i],9))
  }
 })
 it('can enter and leave Shift navigation in an already-held stroke without a button repress',()=>{
  const f=setup(SCHEMES[0],true),before=f.pose()
  f.fire('pointerdown',{buttons:1,clientX:400,clientY:300});f.fire('pointermove',{buttons:1,clientX:410,clientY:300});expect(f.pose()).toEqual(before)
  f.fire('pointermove',{buttons:1,shiftKey:true,clientX:410,clientY:300});f.fire('pointermove',{buttons:1,shiftKey:true,clientX:440,clientY:320});expect(f.pose()).not.toEqual(before)
  f.fire('pointermove',{buttons:1,shiftKey:false,clientX:450,clientY:320});const stopped=f.pose();f.fire('pointermove',{buttons:1,clientX:480,clientY:340});expect(f.pose()).toEqual(stopped);expect(f.nav.navigating()).toBe(false);f.nav.dispose()
 })
 it('puts relocated plain bindings ahead of a pre-existing Shift binding regardless of declaration order',()=>{
  const scheme={id:'priority-test',label:'test',hint:'',bindings:[{buttons:2,shift:true,action:'zoom' as const},{buttons:2,action:'pan' as const}]}
  const f=setup(scheme,true);f.fire('pointerdown',{buttons:2,shiftKey:true,clientX:400,clientY:300});f.fire('pointermove',{buttons:2,shiftKey:true,clientX:430,clientY:320});expect(f.pose().at(-1)).toBe(1);expect(f.pose().slice(6,9)).not.toEqual([0,0,0]);f.nav.dispose()
 })
})
