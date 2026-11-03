// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Preview } from './editorKernel'
import type { Net, Point } from './brep'
import { dragDirection, type DragMode } from './localFrame'
import { bindStripDrag, drawStrip, type StripDrag } from './sheetDrag'
import { netEdges, type NetSelectionMode } from './netSelection'

export interface StripeSettings { orientation: 'horizontal' | 'vertical'; width: number; color: string }
type LayerOptions = StripeSettings & { target: 'visible'; selectedIds: number[] }
interface StripeLayer { setOptions(options: LayerOptions): void; dispose(): void }
type StripeConstructor = new (sources: { bodies(): Map<number, THREE.Mesh>; scan(): null; invalidate(): void }, options: LayerOptions) => StripeLayer
// Some distributions omit the Zebra plugin. Only expose the control when its renderer ships.
const zebraModules = import.meta.glob<StripeConstructor>('../tmar-zebra/ZebraLayer.ts', { eager: true, import: 'ZebraLayer' })
const ZebraRenderer = Object.values(zebraModules)[0]
export const hasSurfaceZebra = Boolean(ZebraRenderer)

interface Props {
  mirrorAxis: number; mirrorOffset: number; mirrorPartners: number[] | null
  strip: StripDrag | null
  notePins: Point[]; placingNote: boolean; onNote: (point:Point|null)=>void
  preview: Preview | null; net: Net | null; selected: number[]; locked: number[]; hiddenPoles: number[]; face: number
  axis: number; onFace: (i: number) => void; onPoints: (ids: number[], multi: boolean) => void
  onDrag: (poles: Point[], final: boolean) => void; busy: boolean
  dragStrength: number; showNet: boolean; transparency: number; dragMode: DragMode
  stripes: StripeSettings | null
  selectionMode: NetSelectionMode
}
export function SurfaceViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), current = useRef(props)
  current.current = props
  const stripeLayer = useRef<StripeLayer | null>(null)
  const sceneRef = useRef<{ scene: THREE.Scene; body: THREE.Group; cage: THREE.Group; hover: THREE.Group; hoverKey: string; camera: THREE.PerspectiveCamera; controls: OrbitControls; radius: number; fitted: boolean } | null>(null)
  useEffect(() => {
    const div = host.current!, scene = new THREE.Scene()
    scene.background = new THREE.Color('#26343e')
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    div.appendChild(renderer.domElement)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000), controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false
    // Left belongs to picking and editing even when the pointer misses a handle.
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x46505e, 2))
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2, 5, 4); scene.add(light)
    const body = new THREE.Group(), cage = new THREE.Group(), hover = new THREE.Group(); scene.add(body, cage, hover)
    const state = { scene, body, cage, hover, hoverKey: '', camera, controls, radius: 1, fitted: false }; sceneRef.current = state
    let drag: { index: number; start: Point[]; ids: number[]; x: number; y: number; sx: number; sy: number; direction: Point; strength: number; screen: { plane: THREE.Plane; start: THREE.Vector3 } | null } | null = null
    let down = { x: 0, y: 0 }
    const raycaster = new THREE.Raycaster()
    const hits = (e: PointerEvent, objects: THREE.Object3D[]) => {
      const r = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera)
      return raycaster.intersectObjects(objects, false)
    }
    const pickNet = (e: PointerEvent): number[] | null => {
      const p = current.current
      if (!p.net) return null
      const hidden = new Set(p.hiddenPoles)
      if (p.selectionMode !== 'edges' && p.selectionMode !== 'cells') {
        const point = hits(e, cage.children.filter(o => o.userData.point !== undefined))[0]
        if (point) return [point.object.userData.point as number]
      }
      if (!p.showNet || p.selectionMode === 'points') return null
      if (p.selectionMode !== 'cells') {
        const r = renderer.domElement.getBoundingClientRect()
        const projected = p.net.poles.map(q => new THREE.Vector3(...q).project(camera))
        let best: number[] | null = null, distance = 7 // CSS pixels, independent of zoom.
        for (const [a, b] of netEdges(p.net)) {
          if (hidden.has(a) || hidden.has(b)) continue
          const pa = projected[a], pb = projected[b]
          if (Math.abs(pa.z) > 1 || Math.abs(pb.z) > 1) continue
          const ax = r.left + (pa.x + 1) * r.width / 2, ay = r.top + (1 - pa.y) * r.height / 2
          const dx = (pb.x - pa.x) * r.width / 2, dy = -(pb.y - pa.y) * r.height / 2
          const length2 = dx * dx + dy * dy
          if (length2 < 1) continue
          const t = Math.max(0, Math.min(1, ((e.clientX - ax) * dx + (e.clientY - ay) * dy) / length2))
          const d = Math.hypot(e.clientX - ax - t * dx, e.clientY - ay - t * dy)
          if (d < distance) { distance = d; best = [a, b] }
        }
        if (best) return best
      }
      if (p.selectionMode === 'cells' || p.selectionMode === 'auto') {
        hits(e, [])
        // The cage may be nonplanar. Pick its nearest visible-depth half-quad
        // but return the four poles, regardless of the internal diagonal.
        const { nu, nv, poles } = p.net
        const vertices = poles.map(x => new THREE.Vector3(...x))
        const hit = new THREE.Vector3()
        let best: number[] | null = null, nearest = Infinity
        for (let u = 0; u < nu - 1; u++) for (let v = 0; v < nv - 1; v++) {
          const a = u * nv + v, b = a + nv, c = b + 1, d = a + 1
          if ([a,b,c,d].some(i=>hidden.has(i))) continue
          for (const [j, k] of [[b, c], [c, d]]) {
            if (!raycaster.ray.intersectTriangle(vertices[a], vertices[j], vertices[k], false, hit)) continue
            const distance = hit.distanceToSquared(raycaster.ray.origin)
            if (distance < nearest && Math.abs(hit.project(camera).z) <= 1) {
              nearest = distance; best = [a, b, c, d]
            }
          }
        }
        return best
      }
      return null
    }
    const showHover = (ids: number[] | null) => {
      const net = current.current.net, key = net && ids ? ids.join(',') : ''
      if (key === state.hoverKey) return
      state.hoverKey = key
      hover.traverse(dispose); hover.clear()
      div.dataset.hoverKind = ids?.length === 1 ? 'point' : ids?.length === 2 ? 'edge' : ids?.length === 4 ? 'cell' : ''
      if (!net || !ids?.length) return
      const points = ids.map(i => new THREE.Vector3(...net.poles[i]))
      if (ids.length === 1) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(state.radius * 0.017, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff9d20, depthTest: false, depthWrite: false }))
        marker.position.copy(points[0]); marker.renderOrder = 7; hover.add(marker)
      } else {
        const path = ids.length === 4 ? [...points, points[0]] : points
        const lineGeometry = new LineGeometry()
        lineGeometry.setPositions(path.flatMap(p => p.toArray()))
        const line = new Line2(lineGeometry, new LineMaterial({ color: 0xff9d20, linewidth: 4, depthTest: false, depthWrite: false }))
        line.renderOrder = 7; hover.add(line)
        if (ids.length === 4) {
          const g = new THREE.BufferGeometry().setFromPoints([points[0],points[1],points[2],points[0],points[2],points[3]])
          const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff9d20, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false, depthWrite: false }))
          fill.renderOrder = 6; hover.add(fill)
        }
      }
    }
    const pickArrow = (e: PointerEvent) => {
      const p=current.current, net=p.net
      if (!net || p.dragMode==='screen' || e.ctrlKey || e.metaKey) return null
      const anchor=p.selected.find(i=>!p.locked.includes(i) && !p.hiddenPoles.includes(i))
      if (anchor===undefined) return null
      const direction=dragDirection(net,anchor,p.dragMode,p.axis)
      if (!direction) return null
      const start=new THREE.Vector3(...net.poles[anchor]), axis=new THREE.Vector3(...direction)
      const tip=start.clone().addScaledVector(axis,state.radius*0.22).project(camera)
      const projected=start.clone().project(camera), rect=div.getBoundingClientRect()
      if (Math.abs(projected.z)>1 || Math.abs(tip.z)>1) return null
      const dx=(tip.x-projected.x)*rect.width/2, dy=(projected.y-tip.y)*rect.height/2
      const length=Math.hypot(dx,dy)
      if (length<8) return null
      const x=e.clientX-rect.left-(projected.x+1)*rect.width/2
      const y=e.clientY-rect.top-(1-projected.y)*rect.height/2
      const along=(x*dx+y*dy)/length
      // Leave the pole itself available for ordinary selection.
      if (along<5 || along>length+4 || Math.abs(x*dy-y*dx)/length>6) return null
      return anchor
    }
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      if (e.button !== 0 || current.current.busy) return
      if (current.current.placingNote) return
      const arrow = pickArrow(e)
      const picked = arrow !== null ? [arrow] : pickNet(e)
      if (!picked) return
      e.stopImmediatePropagation(); controls.enabled = false
      // Also capture selection-only gestures, including locked poles and Ctrl
      // clicks, so a release outside the canvas cannot leave navigation off.
      // Synthetic pointer events can have no active pointer to capture.
      try { renderer.domElement.setPointerCapture(e.pointerId) } catch { /* selection remains usable */ }
      const p = current.current
      if (arrow === null) p.onPoints(picked, e.ctrlKey || e.metaKey)
      if (!p.net || e.ctrlKey || e.metaKey || picked.every(i => p.locked.includes(i))) return
      const ids = (picked.every(i => p.selected.includes(i)) ? p.selected : picked).filter(i => !p.locked.includes(i))
      const anchor = ids[0], index = anchor
      const direction = dragDirection(p.net, anchor, p.dragMode, p.axis)
      if (!direction) return
      const origin = picked.reduce((v, i) => v.add(new THREE.Vector3(...p.net!.poles[i])), new THREE.Vector3()).multiplyScalar(1 / picked.length)
      const end = origin.clone().addScaledVector(new THREE.Vector3(...direction), state.radius)
      hits(e, []) // Edge picking projects segments; refresh the ray for screen dragging.
      // Keep camera depth fixed. The initial ray hit accounts for grabbing off-center.
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), origin)
      const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
      const screen = p.dragMode === 'screen' && start ? { plane, start } : null
      if (p.dragMode === 'screen' && !screen) return
      origin.project(camera); end.project(camera)
      const r = div.getBoundingClientRect(), sx = (end.x - origin.x) * r.width / 2 / state.radius, sy = -(end.y - origin.y) * r.height / 2 / state.radius
      if (!screen && sx * sx + sy * sy < 0.1) return
      drag = { index, start: structuredClone(p.net.poles), ids, x: e.clientX, y: e.clientY, sx, sy, direction, strength: p.dragStrength, screen }
      div.style.cursor = 'grabbing'
    }
    const dragPoles = (e: PointerEvent): Point[] => {
      const d = drag!, poles = structuredClone(d.start)
      if (d.screen) {
        hits(e, []) // Update the pointer ray, without letting the body occlude the handle.
        const hit = raycaster.ray.intersectPlane(d.screen.plane, new THREE.Vector3())
        if (!hit) return poles
        const delta = hit.sub(d.screen.start).multiplyScalar(d.strength)
        d.ids.forEach(i => { poles[i] = poles[i].map((x, j) => x + delta.getComponent(j)) as Point })
        return poles
      }
      const delta = ((e.clientX - d.x) * d.sx + (e.clientY - d.y) * d.sy) / (d.sx * d.sx + d.sy * d.sy)
      d.ids.forEach(i => { poles[i] = poles[i].map((x, j) => x + d.direction[j] * delta * d.strength) as Point })
      return poles
    }
    const pointerMove = (e: PointerEvent) => {
      if (drag) { showHover(null); e.stopImmediatePropagation(); current.current.onDrag(dragPoles(e), false); return }
      if (current.current.placingNote || current.current.busy || current.current.strip) { showHover(null); div.style.cursor='crosshair'; return }
      if (pickArrow(e) !== null) { showHover(null); div.style.cursor='grab'; return }
      const picked = pickNet(e)
      showHover(picked)
      div.style.cursor = picked ? (picked.every(i => current.current.locked.includes(i)) ? 'not-allowed' : 'grab') : 'crosshair'
    }
    const pointerUp = (e: PointerEvent) => {
      if (drag) { e.stopImmediatePropagation(); current.current.onDrag(dragPoles(e), true); drag = null }
      else if (current.current.placingNote && !current.current.busy && e.button===0 && Math.hypot(e.clientX-down.x,e.clientY-down.y)<3) {
        const hit=hits(e,body.children)[0]
        current.current.onNote(hit?.object.userData.face===current.current.face ? hit.point.toArray() as Point : null)
      }
      else if (e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 3 && !pickNet(e)) {
        const hit = hits(e, body.children)[0]; if (hit && !current.current.net && !current.current.busy) current.current.onFace(hit.object.userData.face)
      }
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId)
      controls.enabled = true; div.style.cursor = 'crosshair'
    }
    const cancel = (e: PointerEvent) => {
      if (drag) current.current.onDrag(drag.start, false)
      drag = null
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId)
      showHover(null); controls.enabled = true; div.style.cursor = 'crosshair'
    }
    const pointerLeave = () => showHover(null)
    renderer.domElement.addEventListener('pointerdown', pointerDown, true)
    renderer.domElement.addEventListener('pointermove', pointerMove, true)
    renderer.domElement.addEventListener('pointerup', pointerUp, true)
    renderer.domElement.addEventListener('pointercancel', cancel, true)
    renderer.domElement.addEventListener('pointerleave', pointerLeave)
    const unbindStrip=bindStripDrag(div,camera,()=>current.current.strip,()=>current.current.busy)
    const resize = new ResizeObserver(() => { const w = div.clientWidth, h = div.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix() }); resize.observe(div)
    renderer.setAnimationLoop(() => renderer.render(scene, camera))
    return () => { unbindStrip(); resize.disconnect(); renderer.domElement.removeEventListener('pointerleave', pointerLeave); stripeLayer.current?.dispose(); stripeLayer.current = null; renderer.setAnimationLoop(null); controls.dispose(); scene.traverse(dispose); renderer.dispose(); div.removeChild(renderer.domElement); sceneRef.current = null }
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
    if (props.stripes && ZebraRenderer) {
      const options: LayerOptions = { ...props.stripes, target: 'visible', selectedIds: [] }
      stripeLayer.current ??= new ZebraRenderer({
        bodies: () => new Map(s.body.children.map((o,i) => [i,o as THREE.Mesh])),
        scan: () => null, invalidate: () => {},
      }, options)
      stripeLayer.current.setOptions(options)
    } else {
      stripeLayer.current?.dispose()
      stripeLayer.current = null
    }
    s.body.children.forEach(o => {
      const material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      material.opacity = 1 - props.transparency
      material.transparent = props.transparency > 0
      const overlay = o.children.find(child => child.userData.tmarZebra) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined
      material.colorWrite = !overlay
      material.depthWrite = !overlay && props.transparency === 0
      if (overlay) {
        overlay.material.transparent = props.transparency > 0
        overlay.material.opacity = material.opacity
        overlay.material.depthWrite = props.transparency === 0
        overlay.material.side = material.side
      }
      material.needsUpdate = true
    })
  }, [props.preview, props.face, props.transparency, props.stripes])
  useLayoutEffect(() => {
    const s = sceneRef.current; if (!s) return
    s.cage.traverse(dispose); s.cage.clear()
    s.hover.traverse(dispose); s.hover.clear(); s.hoverKey = ''
    if (host.current) host.current.dataset.hoverKind = ''
    const n = props.net; if (!n) return
    const hidden = new Set(props.hiddenPoles)
    const mirrored = new Set<number>()
    if (props.mirrorPartners) {
      for (const i of props.selected) {
        const j = props.mirrorPartners[i]
        if (j >= 0 && !props.locked.includes(i) && !props.locked.includes(j)) mirrored.add(j)
      }
      const axis = props.mirrorAxis, u = (axis + 1) % 3, v = (axis + 2) % 3
      const box = new THREE.Box3().setFromPoints(n.poles.map(p => new THREE.Vector3(...p)))
      const pad = s.radius * 0.08
      const corners = [[0,0], [1,0], [1,1], [0,1]].map(([highU, highV]) => {
        const corner = new THREE.Vector3()
        corner.setComponent(axis, props.mirrorOffset)
        corner.setComponent(u, highU ? box.max.getComponent(u) + pad : box.min.getComponent(u) - pad)
        corner.setComponent(v, highV ? box.max.getComponent(v) + pad : box.min.getComponent(v) - pad)
        return corner
      })
      const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners),
        new THREE.LineBasicMaterial({ color: '#f785ff', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }))
      frame.renderOrder = 3
      s.cage.add(frame)
    }
    n.poles.forEach((p, i) => {
      if (hidden.has(i)) return
      const color = props.selected.includes(i) ? '#ffcf35' : props.locked.includes(i) ? '#89939c' : mirrored.has(i) ? '#f785ff' : '#58f3d0'
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(s.radius * 0.012, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false })); mesh.position.set(...p); mesh.userData.point = i; mesh.renderOrder = 5; s.cage.add(mesh)
      // Picking can run before the next render after the cage is rebuilt.
      mesh.updateWorldMatrix(true, false)
    })
    const anchor = props.selected.find(i => !props.locked.includes(i) && !hidden.has(i))
    if (anchor !== undefined && props.dragMode !== 'screen') {
      const direction = dragDirection(n, anchor, props.dragMode, props.axis)
      if (direction) {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(...direction), new THREE.Vector3(...n.poles[anchor]), s.radius * 0.22, 0xffcf35, s.radius * 0.045, s.radius * 0.025)
        // ArrowHelper shares default geometry globally; this viewport owns only its clones.
        arrow.line.geometry = arrow.line.geometry.clone(); arrow.cone.geometry = arrow.cone.geometry.clone()
        arrow.traverse(o => { const m = o as THREE.Mesh; if (m.material && !Array.isArray(m.material)) { m.material.transparent = true; m.material.depthTest = false; m.material.depthWrite = false }; o.renderOrder = 6 })
        s.cage.add(arrow)
      }
    }
    if (!props.showNet) return // Hide the connecting cage, retain editable poles.
    const lines: number[] = [], colors: number[] = []
    for (const [a, b] of netEdges(n)) {
      if (hidden.has(a) || hidden.has(b)) continue
      lines.push(...n.poles[a], ...n.poles[b])
      const c = new THREE.Color(props.selected.includes(a) && props.selected.includes(b) ? '#ffcf35' : '#95e7ea')
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false })); line.renderOrder = 4; s.cage.add(line)
  }, [props.net, props.selected, props.locked, props.hiddenPoles, props.showNet, props.dragMode, props.axis, props.mirrorAxis, props.mirrorOffset, props.mirrorPartners])
  useEffect(() => {
    const state=sceneRef.current
    if (!state || !props.notePins.length) return
    const pins=new THREE.Group()
    for (const point of props.notePins) {
      const marker=new THREE.Mesh(new THREE.OctahedronGeometry(state.radius*0.026),
        new THREE.MeshBasicMaterial({color:0xff699b,transparent:true,depthTest:false,depthWrite:false}))
      marker.position.set(...point); marker.renderOrder=8; pins.add(marker)
    }
    state.scene.add(pins)
    return ()=>{pins.removeFromParent();pins.traverse(dispose)}
  },[props.notePins])
  useEffect(()=>{
    const state=sceneRef.current
    if(!props.strip || !state)return
    const group=drawStrip(props.strip);state.scene.add(group)
    return ()=>{group.removeFromParent();group.traverse(dispose)}
  },[props.strip])
  return <div ref={host} className="es-viewport" data-test="edit-surface-viewport" data-hidden-poles={props.hiddenPoles.length} />
}
function dispose(o: THREE.Object3D) { const m = o as THREE.Mesh; m.geometry?.dispose(); if (Array.isArray(m.material)) m.material.forEach(a => a.dispose()); else m.material?.dispose() }
