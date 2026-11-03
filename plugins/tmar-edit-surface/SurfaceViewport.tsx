// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Preview } from './editorKernel'
import type { Net, Point } from './brep'

interface Props {
  preview: Preview | null; net: Net | null; selected: number[]; locked: number[]; face: number
  axis: number; onFace: (i: number) => void; onPoint: (i: number, multi: boolean) => void
  onDrag: (poles: Point[], final: boolean) => void; busy: boolean
  dragStrength: number; showNet: boolean; transparency: number
}
export function SurfaceViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), current = useRef(props)
  current.current = props
  const sceneRef = useRef<{ scene: THREE.Scene; body: THREE.Group; cage: THREE.Group; camera: THREE.PerspectiveCamera; controls: OrbitControls; radius: number; fitted: boolean } | null>(null)
  useEffect(() => {
    const div = host.current!, scene = new THREE.Scene()
    scene.background = new THREE.Color('#26343e')
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    div.appendChild(renderer.domElement)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000), controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x46505e, 2))
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2, 5, 4); scene.add(light)
    const body = new THREE.Group(), cage = new THREE.Group(); scene.add(body, cage)
    const state = { scene, body, cage, camera, controls, radius: 1, fitted: false }; sceneRef.current = state
    let drag: { index: number; start: Point[]; ids: number[]; x: number; y: number; sx: number; sy: number; axis: number; strength: number } | null = null
    let down = { x: 0, y: 0 }
    const raycaster = new THREE.Raycaster()
    const hits = (e: PointerEvent, objects: THREE.Object3D[]) => {
      const r = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera)
      return raycaster.intersectObjects(objects, false)
    }
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      if (e.button !== 0 || current.current.busy) return
      const point = hits(e, cage.children.filter(o => o.userData.point !== undefined))[0]
      if (!point) return
      e.stopImmediatePropagation(); controls.enabled = false
      const p = current.current, index = point.object.userData.point as number
      p.onPoint(index, e.ctrlKey || e.metaKey)
      if (!p.net || p.locked.includes(index) || e.ctrlKey || e.metaKey) return
      const origin = new THREE.Vector3(...p.net.poles[index]), end = origin.clone(); end.setComponent(p.axis, end.getComponent(p.axis) + state.radius)
      origin.project(camera); end.project(camera)
      const r = div.getBoundingClientRect(), sx = (end.x - origin.x) * r.width / 2 / state.radius, sy = -(end.y - origin.y) * r.height / 2 / state.radius
      if (sx * sx + sy * sy < 0.1) return
      drag = { index, start: structuredClone(p.net.poles), ids: p.selected.includes(index) ? p.selected.filter(i => !p.locked.includes(i)) : [index], x: e.clientX, y: e.clientY, sx, sy, axis: p.axis, strength: p.dragStrength }
      renderer.domElement.setPointerCapture(e.pointerId); div.style.cursor = 'grabbing'
    }
    const dragPoles = (e: PointerEvent): Point[] => {
      const d = drag!, poles = structuredClone(d.start), delta = ((e.clientX - d.x) * d.sx + (e.clientY - d.y) * d.sy) / (d.sx * d.sx + d.sy * d.sy)
      d.ids.forEach(i => { poles[i][d.axis] += delta * d.strength })
      return poles
    }
    const pointerMove = (e: PointerEvent) => {
      if (drag) { e.stopImmediatePropagation(); current.current.onDrag(dragPoles(e), false); return }
      const point = hits(e, cage.children.filter(o => o.userData.point !== undefined))[0]
      div.style.cursor = point ? (current.current.locked.includes(point.object.userData.point) ? 'not-allowed' : 'grab') : 'crosshair'
    }
    const pointerUp = (e: PointerEvent) => {
      if (drag) { e.stopImmediatePropagation(); current.current.onDrag(dragPoles(e), true); drag = null; renderer.domElement.releasePointerCapture(e.pointerId) }
      else if (e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 3 && !hits(e, cage.children.filter(o => o.userData.point !== undefined)).length) {
        const hit = hits(e, body.children)[0]; if (hit && !current.current.net && !current.current.busy) current.current.onFace(hit.object.userData.face)
      }
      controls.enabled = true; div.style.cursor = 'crosshair'
    }
    const cancel = () => { if (drag) current.current.onDrag(drag.start, false); drag = null; controls.enabled = true }
    renderer.domElement.addEventListener('pointerdown', pointerDown, true)
    renderer.domElement.addEventListener('pointermove', pointerMove, true)
    renderer.domElement.addEventListener('pointerup', pointerUp, true)
    renderer.domElement.addEventListener('pointercancel', cancel, true)
    const resize = new ResizeObserver(() => { const w = div.clientWidth, h = div.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix() }); resize.observe(div)
    renderer.setAnimationLoop(() => renderer.render(scene, camera))
    return () => { resize.disconnect(); renderer.setAnimationLoop(null); controls.dispose(); scene.traverse(dispose); renderer.dispose(); div.removeChild(renderer.domElement); sceneRef.current = null }
  }, [])
  useEffect(() => {
    const s = sceneRef.current; if (!s || !props.preview) return
    s.body.children.forEach(dispose); s.body.clear()
    props.preview.faceMeshes.forEach((m, i) => {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3)); geometry.setIndex(new THREE.BufferAttribute(m.indices, 1))
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: i === props.face ? '#6ebde4' : '#a4acb0', metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide })); mesh.userData.face = i; s.body.add(mesh)
    })
    if (!s.fitted) {
      const box = new THREE.Box3().setFromObject(s.body), center = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1)
      s.radius = r; s.camera.position.copy(center).add(new THREE.Vector3(1.5, -1.9, 1.8).multiplyScalar(r)); s.camera.up.set(0, 0, 1); s.camera.near = r / 1000; s.camera.far = r * 100; s.camera.updateProjectionMatrix(); s.controls.target.copy(center); s.controls.update(); s.fitted = true
    }
  }, [props.preview, props.face])
  useEffect(() => {
    const s = sceneRef.current; if (!s) return
    s.body.children.forEach(o => {
      const material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      material.opacity = 1 - props.transparency
      material.transparent = props.transparency > 0
      material.depthWrite = props.transparency === 0
      material.needsUpdate = true
    })
  }, [props.preview, props.face, props.transparency])
  useEffect(() => {
    const s = sceneRef.current; if (!s) return
    s.cage.children.forEach(dispose); s.cage.clear()
    const n = props.net; if (!n) return
    n.poles.forEach((p, i) => {
      const color = props.selected.includes(i) ? '#ffcf35' : props.locked.includes(i) ? '#89939c' : '#58f3d0'
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(s.radius * 0.012, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false })); mesh.position.set(...p); mesh.userData.point = i; mesh.renderOrder = 5; s.cage.add(mesh)
    })
    if (!props.showNet) return // Hide the connecting cage, retain editable poles.
    const lines: number[] = []
    for (let i = 0; i < n.nu; i++) for (let j = 0; j < n.nv; j++) { const at = i * n.nv + j; if (i + 1 < n.nu) lines.push(...n.poles[at], ...n.poles[at + n.nv]); if (j + 1 < n.nv) lines.push(...n.poles[at], ...n.poles[at + 1]) }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)); const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#95e7ea', depthTest: false, transparent: true, opacity: 0.6 })); line.renderOrder = 4; s.cage.add(line)
  }, [props.net, props.selected, props.locked, props.showNet])
  return <div ref={host} className="es-viewport" data-test="edit-surface-viewport" />
}
function dispose(o: THREE.Object3D) { const m = o as THREE.Mesh; m.geometry?.dispose(); if (Array.isArray(m.material)) m.material.forEach(a => a.dispose()); else m.material?.dispose() }
