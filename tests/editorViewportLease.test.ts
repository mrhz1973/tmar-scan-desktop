// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { editorProjectPart, editorRayInPart } from '../src/viewer/editorViewportLease'
import { SceneManager } from '../src/viewer/SceneManager'

const rect = { left: 50, top: 100, width: 900, height: 600 }
describe('main viewport math and exclusive routing', () => {
  for (const perspective of [false, true]) {
    it(`round trips a transformed part with ${perspective ? 'perspective' : 'orthographic'} camera`, () => {
      const camera = perspective ? new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000) : new THREE.OrthographicCamera(-30,30,20,-20,0.1,1000)
      camera.position.set(45,-60,90); camera.lookAt(0,0,0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(3,7,-2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3,-0.2,0.7)), new THREE.Vector3(1,1,1))
      const point: [number,number,number] = [4,5,6]
      const screen = editorProjectPart(camera,matrix,rect,point)
      const ray = editorRayInPart(camera,matrix,rect,screen.clientX,screen.clientY)!
      const actual = new THREE.Ray(new THREE.Vector3(...ray.origin),new THREE.Vector3(...ray.direction)).distanceToPoint(new THREE.Vector3(...point))
      expect(actual).toBeLessThan(1e-11)
      expect(screen.visible).toBe(true)
    })
  }
  it('rejects collapsed viewports and singular transforms', () => {
    const camera = new THREE.OrthographicCamera()
    expect(editorRayInPart(camera,new THREE.Matrix4(),{...rect,width:0},0,0)).toBeNull()
    expect(editorRayInPart(camera,new THREE.Matrix4().makeScale(0,1,1),rect,0,0)).toBeNull()
  })
  it('dispatches the exclusive editor before marking and grips and does not fall through', () => {
    // Exercise the actual routing method without constructing a WebGL renderer.
    const scene = Object.create(SceneManager.prototype)
    // A non-gizmo press must remain exclusively owned by the editor.
    // Gizmo hits have higher priority and are covered by qaEditorGizmoRouting.
    scene.gizmoAt = vi.fn(() => null)
    scene.editorInput = { pointerDown: vi.fn(() => false) }
    scene.marking = { pointerGesture: vi.fn(() => ({})), handlePointerDown: vi.fn() }
    scene.grips = { handlePointerDown: vi.fn() }
    scene.sortedLayers = vi.fn(() => [])
    expect(scene.handlePointerDown({ button:0,shiftKey:false,ctrlKey:false,metaKey:false })).toBe(false)
    expect(scene.editorInput.pointerDown).toHaveBeenCalledTimes(1)
    expect(scene.gizmoAt).toHaveBeenCalledOnce()
    expect(scene.marking.pointerGesture).not.toHaveBeenCalled(); expect(scene.grips.handlePointerDown).not.toHaveBeenCalled()
  })
  it('does not leak an empty editor click to model selection', () => {
    const scene = Object.create(SceneManager.prototype)
    scene.editorInput = { click: vi.fn(() => false) }
    scene.clickSteps = vi.fn(() => []); scene.onPick = vi.fn()
    scene.handleClick(10,20,false)
    expect(scene.editorInput.click).toHaveBeenCalledWith(10,20,false)
    expect(scene.clickSteps).not.toHaveBeenCalled(); expect(scene.onPick).not.toHaveBeenCalled()
  })

})
