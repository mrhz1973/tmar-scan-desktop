// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Preview } from './editorKernel'
import type { Net, Point } from './brep'
import { dragDirection, type DragMode } from './localFrame'
import { createDragFrame } from './dragFrame'
import { createSurfaceGesture, type SurfaceGesture, type SurfacePointer } from './surfaceGesture'
import { bindStripDrag, drawStrip, pickSheetEdge, type DirectStrip, type StripDrag } from './sheetDrag'
import type { NetSelectionMode } from './netSelection'
import { pickNetAt } from './netPicking'
import { populateSurfaceCage } from './surfaceCage'
import { sceneOf } from '../../src/commands/host'
import { reSceneOf } from '../reverse/viewer/reScene'
import { withBoundsTree } from '../reverse/viewer/bodyPicks'
import { snapAlong, type SnapHit } from './snap'

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
  strip: StripDrag | null; directStrip: DirectStrip | null; stripBlocked: () => boolean
  notePins: Point[]; placingNote: boolean; onNote: (point:Point|null)=>void
  preview: Preview | null; net: Net | null; selected: readonly number[]; locked: readonly number[]; hiddenPoles: number[]; face: number
  axis: number; onFace: (i: number) => void; onPoints: (ids: number[], multi: boolean) => void
  onDrag: (poles: Point[], final: boolean) => void; busy: boolean
  dragStrength: number; showNet: boolean; transparency: number; dragMode: DragMode
  stripes: StripeSettings | null
  selectionMode: NetSelectionMode
  snap: boolean; snapDistance: number; referenceBody: number | null
  onReferenceCount: (count: number) => void
  registerCancel: (fn: () => boolean) => void
}
export function SurfaceViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), current = useRef(props)
  const handle = useRef<HTMLButtonElement>(null)
  const handleLeader = useRef<HTMLDivElement>(null)
  const snapFeedback = useRef<HTMLDivElement>(null)
  const [edgeHandle, setEdgeHandleState] = useState<{edge:number; anchor:Point}|null>(null)
  const edgeHandleRef = useRef(edgeHandle)
  const setEdgeHandle = (value:{edge:number; anchor:Point}|null) => {
    if(handle.current) handle.current.style.visibility='hidden'
    if(handleLeader.current) handleLeader.current.style.visibility='hidden'
    edgeHandleRef.current=value;setEdgeHandleState(value)
  }
  current.current = props
  const stripeLayer = useRef<StripeLayer | null>(null)
  const sceneRef = useRef<{ scene: THREE.Scene; body: THREE.Group; references: THREE.Group; cage: THREE.Group; hover: THREE.Group; hoverKey: string; camera: THREE.PerspectiveCamera; controls: OrbitControls; radius: number; fitted: boolean } | null>(null)
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
    const body = new THREE.Group(), references = new THREE.Group(), cage = new THREE.Group(), hover = new THREE.Group(); scene.add(references, body, cage, hover)
    const state = { scene, body, references, cage, hover, hoverKey: '', camera, controls, radius: 1, fitted: false }; sceneRef.current = state
    let drag: { pointerId: number; gesture: SurfaceGesture } | null = null
    let down = { x: 0, y: 0 }
    const raycaster = new THREE.Raycaster()
    const releaseCapture = (id: number) => {
      try { if (renderer.domElement.hasPointerCapture(id)) renderer.domElement.releasePointerCapture(id) }
      catch (error) {
        // A lost/cancelled pointer can disappear between the browser checks.
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      }
    }
    const netFrame = new THREE.Matrix4() // This prototype keeps the net in the scene frame.
    const hits = (e: PointerEvent, objects: THREE.Object3D[]) => {
      const r = renderer.domElement.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera)
      return raycaster.intersectObjects(objects, false)
    }
    const pickNet = (e: PointerEvent): number[] | null => {
      const p = current.current
      if (!p.net) return null
      if (p.selectionMode !== 'edges' && p.selectionMode !== 'cells') {
        const point = hits(e, cage.children.filter(o => o.userData.point !== undefined))[0]
        if (point) return [point.object.userData.point as number]
      }
      if (!p.showNet || p.selectionMode === 'points') return null
      // Keep pole picking on the actual visible handles; use the shared
      // screen-space picker for segments and cells in either viewport.
      return pickNetAt({ net: p.net, mode: p.selectionMode, hiddenPoles: p.hiddenPoles,
        camera, partWorld: netFrame, rect: renderer.domElement.getBoundingClientRect(),
        clientX: e.clientX, clientY: e.clientY, pointRadiusPx: 0 })
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
    const showSnap = (hit: SnapHit | null) => {
      div.dataset.snapKind = hit?.kind ?? ''
      const label=snapFeedback.current
      if (!label) return
      if (!hit) { label.style.display='none'; return }
      const p=hit.point.clone().project(camera), rect=div.getBoundingClientRect()
      label.style.left=((p.x+1)*rect.width/2)+'px'; label.style.top=((1-p.y)*rect.height/2)+'px'
      label.textContent='●  Agganciato: '+hit.label; label.style.display='block'
    }
    const showSnapError = (pointer: SurfacePointer) => {
      showSnap(null)
      const label=snapFeedback.current
      if (!label) return
      div.dataset.snapKind='error'
      label.textContent='Magnete non disponibile per questo riferimento'
      label.style.left=(pointer.clientX-div.getBoundingClientRect().left)+'px'
      label.style.top=(pointer.clientY-div.getBoundingClientRect().top)+'px'
      label.style.display='block'
    }
    const pointerSample = (e: PointerEvent): SurfacePointer => {
      const p=current.current
      return { pointerId:e.pointerId, clientX:e.clientX, clientY:e.clientY, altKey:e.altKey,
        snapEnabled:p.snap && Number.isFinite(p.snapDistance) && p.snapDistance>0 && p.snapDistance<=1000 }
    }
    const pointerDown = (e: PointerEvent) => {
      if (drag) { e.stopImmediatePropagation(); return } // A second pointer cannot replace the active gesture.
      down = { x: e.clientX, y: e.clientY }
      if (e.button !== 0 || current.current.busy) return
      if (current.current.placingNote) return
      const arrow = pickArrow(e)
      const direct=current.current.directStrip
      if (arrow===null && !e.ctrlKey && !e.metaKey) {
        const edge=direct && pickSheetEdge(direct.paths,camera,div.getBoundingClientRect(),e.clientX,e.clientY)
        setEdgeHandle(edge ? {edge:edge.edge,anchor:edge.anchor.toArray() as Point} : null)
      }
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
      const index = ids[0], direction = dragDirection(p.net, index, p.dragMode, p.axis)
      if (!direction) return
      const origin = picked.reduce((v, i) => v.add(new THREE.Vector3(...p.net!.poles[i])), new THREE.Vector3()).multiplyScalar(1 / picked.length)
      const snapDirection = p.dragMode === 'screen'
        ? camera.getWorldDirection(new THREE.Vector3())
        : new THREE.Vector3(...direction)
      const frame = createDragFrame({ camera, partWorld: netFrame, rect: div.getBoundingClientRect(),
        anchor: origin.toArray() as Point, clientX: e.clientX, clientY: e.clientY,
        ...(p.dragMode === 'screen' ? { mode: 'screen' as const } : { mode: 'axis' as const, direction }) })
      if (!frame) return
      const startAnchor = new THREE.Vector3(...p.net.poles[index])
      const gesture = createSurfaceGesture({ frame, poles:p.net.poles, selected:ids,
        start:pointerSample(e), strength:p.dragStrength,
        resolveDelta: (delta, pointer) => {
          const now=current.current
          try {
            const refs=references.children.filter(o=>typeof o.userData.isCurrent!=='function' || o.userData.isCurrent()) as THREE.Mesh[]
            // Exclude the edited face itself: otherwise it immediately attracts its own poles.
            const neighbours=body.children.filter(o=>o.userData.face!==now.face) as THREE.Mesh[]
            const targets=[...refs,...neighbours]
            targets.forEach(target=>{ if (!target.userData.borrowedGeometry) withBoundsTree(target) })
            const candidate=startAnchor.clone().add(new THREE.Vector3(...delta))
            const snapHit=snapAlong(candidate,snapDirection,now.snapDistance,targets)
            showSnap(snapHit)
            return snapHit ? snapHit.point.clone().sub(startAnchor).toArray() as Point : null
          } catch {
            // A failed reference must not prevent the unconstrained drag.
            showSnapError(pointer)
            return null
          }
        } })
      if (!gesture) return
      drag = { pointerId:e.pointerId, gesture }
      div.style.cursor = 'grabbing'
    }
    const pointerMove = (e: PointerEvent) => {
      if (drag) {
        if (e.pointerId !== drag.pointerId) { e.stopImmediatePropagation(); return }
        e.stopImmediatePropagation()
        const sample=pointerSample(e)
        if (sample.altKey || !sample.snapEnabled) showSnap(null)
        const result=drag.gesture.move(sample)
        if (result.kind === 'preview') { showHover(null); current.current.onDrag(result.poles, false) }
        return
      }
      if (current.current.placingNote || current.current.busy || current.current.strip) { showHover(null); div.style.cursor='crosshair'; return }
      if (pickArrow(e) !== null) { showHover(null); div.style.cursor='grab'; return }
      const picked = pickNet(e)
      showHover(picked)
      div.style.cursor = picked ? (picked.every(i => current.current.locked.includes(i)) ? 'not-allowed' : 'grab') : 'crosshair'
    }
    const pointerUp = (e: PointerEvent) => {
      if (drag && e.pointerId !== drag.pointerId) { e.stopImmediatePropagation(); return }
      if (drag) {
        e.stopImmediatePropagation()
        const active=drag, sample=pointerSample(e)
        if (sample.altKey || !sample.snapEnabled) showSnap(null)
        const result=active.gesture.up(sample); drag=null
        if (result.kind === 'commit') current.current.onDrag(result.poles, true)
        else if (result.kind === 'restore') current.current.onDrag(result.poles, false)
        showSnap(null)
      }
      else if (current.current.placingNote && !current.current.busy && e.button===0 && Math.hypot(e.clientX-down.x,e.clientY-down.y)<3) {
        const hit=hits(e,body.children)[0]
        current.current.onNote(hit?.object.userData.face===current.current.face ? hit.point.toArray() as Point : null)
      }
      else if (e.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 3 && !pickNet(e)) {
        const hit = hits(e, body.children)[0]; if (hit && !current.current.net && !current.current.busy) current.current.onFace(hit.object.userData.face)
      }
      releaseCapture(e.pointerId)
      controls.enabled = true; div.style.cursor = 'crosshair'
    }
    const cancelGesture = () => {
      if (!drag) return false
      const cancelled = drag; drag = null
      const result=cancelled.gesture.cancel()
      releaseCapture(cancelled.pointerId)
      if (result.kind === 'restore') current.current.onDrag(result.poles, false)
      showSnap(null); showHover(null); controls.enabled = true; div.style.cursor = 'crosshair'
      return true
    }
    const cancel = (e: PointerEvent) => {
      if (drag && e.pointerId !== drag.pointerId) { e.stopImmediatePropagation(); return }
      cancelGesture()
      releaseCapture(e.pointerId)
      showHover(null); controls.enabled = true; div.style.cursor = 'crosshair'
    }
    const pointerLeave = () => showHover(null)
    renderer.domElement.addEventListener('pointerdown', pointerDown, true)
    renderer.domElement.addEventListener('pointermove', pointerMove, true)
    renderer.domElement.addEventListener('pointerup', pointerUp, true)
    renderer.domElement.addEventListener('pointercancel', cancel, true)
    renderer.domElement.addEventListener('lostpointercapture', cancel, true)
    renderer.domElement.addEventListener('pointerleave', pointerLeave)
    window.addEventListener('blur', cancelGesture)
    const stripBinding=bindStripDrag(div,camera,()=>current.current.strip,()=>current.current.busy || current.current.stripBlocked(),()=>current.current.directStrip)
    current.current.registerCancel(()=>cancelGesture() || stripBinding.cancel())
    let lastWidth = div.clientWidth, lastHeight = div.clientHeight
    const resize = new ResizeObserver(() => { const w = div.clientWidth, h = div.clientHeight; if (drag && (w !== lastWidth || h !== lastHeight)) cancelGesture(); lastWidth = w; lastHeight = h; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix() }); resize.observe(div)
    renderer.setAnimationLoop(() => {
      references.children.forEach(o=>{ if (typeof o.userData.isCurrent==='function') o.visible=o.userData.isCurrent() })
      renderer.render(scene, camera)
      const button=handle.current, selected=edgeHandleRef.current
      if (button && selected) {
        const p=new THREE.Vector3(...selected.anchor).project(camera), r=div.getBoundingClientRect()
        const x=(p.x+1)*r.width/2, y=(1-p.y)*r.height/2
        const hx=x+(x+52<r.width?36:-36), hy=y+(y>52?-32:32)
        const visible=Math.abs(p.z)<=1 && x>=0 && x<=r.width && y>=0 && y<=r.height && hx>=14 && hx<=r.width-14 && hy>=14 && hy<=r.height-14
        button.style.left=hx+'px';button.style.top=hy+'px';button.style.visibility=visible?'visible':'hidden'
        const leader=handleLeader.current
        if (leader) {
          leader.style.left=x+'px';leader.style.top=y+'px'
          leader.style.width=Math.hypot(hx-x,hy-y)+'px'
          leader.style.transform=`rotate(${Math.atan2(hy-y,hx-x)}rad)`
          leader.style.visibility=visible?'visible':'hidden'
        }
      }
    })
    return () => { current.current.registerCancel(()=>false); stripBinding.dispose(); resize.disconnect(); window.removeEventListener('blur', cancelGesture); renderer.domElement.removeEventListener('pointerleave', pointerLeave); if (drag) releaseCapture(drag.pointerId); drag = null; stripeLayer.current?.dispose(); stripeLayer.current = null; renderer.setAnimationLoop(null); controls.dispose(); scene.traverse(dispose); renderer.dispose(); div.removeChild(renderer.domElement); sceneRef.current = null }
  }, [])
  // Clear stale handles before the restored canvas can receive the next click.
  useLayoutEffect(() => { setEdgeHandle(null) }, [props.directStrip?.revision])
  useEffect(() => {
    const s = sceneRef.current; if (!s || !props.preview) return
    s.body.children.forEach(dispose); s.body.clear()
    props.preview.faceMeshes.forEach((m, i) => {
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3)); geometry.setIndex(new THREE.BufferAttribute(m.indices, 1))
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: i === props.face ? '#6ebde4' : '#a4acb0', metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide })); mesh.userData.face = i; s.body.add(mesh)
      mesh.userData.snapKind='cad'; mesh.userData.snapLabel=`Faccia CAD ${i+1}`
    })
    if (!s.fitted) {
      const box = new THREE.Box3().setFromObject(s.body), center = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1)
      s.radius = r; s.camera.position.copy(center).add(new THREE.Vector3(1.5, -1.9, 1.8).multiplyScalar(r)); s.camera.up.set(0, 0, 1); s.camera.near = r / 1000; s.camera.far = r * 100; s.camera.updateProjectionMatrix(); s.controls.target.copy(center); s.controls.update(); s.fitted = true
    }
  }, [props.preview, props.face])
  useEffect(() => {
    const s=sceneRef.current
    if (!s) return
    s.references.children.forEach(dispose); s.references.clear()
    const owner=props.referenceBody === null ? null : sceneOf()
    if (!owner || !props.snap) { props.onReferenceCount(0); return }
    const part=owner.layerHost().partGroup
    part.updateWorldMatrix(true,true)
    const inverse=part.matrixWorld.clone().invert()
    const add=(sourceGeometry:THREE.BufferGeometry, matrix:THREE.Matrix4, kind:'scan'|'cad', label:string, isCurrent:()=>boolean) => {
      // Scan already has a BVH. For CAD, build any needed BVH on our own
      // geometry wrapper, sharing the immutable buffers without touching host state.
      const geometry=kind==='scan' ? sourceGeometry : new THREE.BufferGeometry()
      if (geometry!==sourceGeometry) {
        geometry.setAttribute('position',sourceGeometry.getAttribute('position'))
        const normal=sourceGeometry.getAttribute('normal'); if (normal) geometry.setAttribute('normal',normal)
        geometry.setIndex(sourceGeometry.getIndex())
        geometry.boundingBox=sourceGeometry.boundingBox?.clone() ?? null
        geometry.boundingSphere=sourceGeometry.boundingSphere?.clone() ?? null
      }
      const material=new THREE.MeshStandardMaterial({color:kind==='scan'?'#c9bd9a':'#91a7bd',transparent:true,opacity:0.28,depthWrite:false,side:THREE.DoubleSide})
      const mesh=new THREE.Mesh(geometry,material)
      mesh.matrix.copy(matrix);mesh.matrixAutoUpdate=false;mesh.userData.borrowedGeometry=kind==='scan'
      mesh.userData.snapKind=kind;mesh.userData.snapLabel=label;mesh.userData.isCurrent=isCurrent
      s.references.add(mesh);mesh.updateWorldMatrix(true,false)
    }
    const scan=owner.scanShown() ? owner.scanGeometry() : null
    if (scan) add(scan,new THREE.Matrix4(),'scan','Scansione',()=>sceneOf()===owner && owner.scanShown() && owner.scanGeometry()===scan)
    const scene=reSceneOf(owner)
    for (const [id,mesh] of scene.bodyMeshes) {
      const shown=()=>mesh.visible && (Array.isArray(mesh.material) ? mesh.material.some(m=>m.visible) : mesh.material.visible)
      if (id===props.referenceBody || !shown() || !(mesh.geometry instanceof THREE.BufferGeometry)) continue
      mesh.updateWorldMatrix(true,false)
      const geometry=mesh.geometry, matrix=inverse.clone().multiply(mesh.matrixWorld)
      add(geometry,matrix,'cad',`Corpo CAD ${id}`,()=>sceneOf()===owner && scene.bodyMeshes.get(id)===mesh && shown() && mesh.geometry===geometry)
    }
    props.onReferenceCount(s.references.children.length)
    return ()=>{s.references.children.forEach(dispose);s.references.clear()}
  },[props.referenceBody,props.snap])
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
    populateSurfaceCage(s.cage, {
      net: n, selected: props.selected, locked: props.locked, hiddenPoles: props.hiddenPoles,
      showNet: props.showNet, dragMode: props.dragMode, axis: props.axis, radius: s.radius,
      mirrorAxis: props.mirrorAxis, mirrorOffset: props.mirrorOffset, mirrorPartners: props.mirrorPartners,
    })
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
  return <div ref={host} className="es-viewport" data-test="edit-surface-viewport" data-hidden-poles={props.hiddenPoles.length} data-direct-edges={props.directStrip?.paths.length ?? 0}>
    <div ref={snapFeedback} className="es-snap-feedback" data-test="surface-snap-feedback" style={{display:'none'}} />
    {edgeHandle && props.directStrip && !props.busy && <><div ref={handleLeader} className="es-direct-leader" style={{visibility:'hidden'}} /><button ref={handle} type="button" className="es-direct-handle" style={{visibility:'hidden'}}
      data-test="strip-direct-handle" data-strip-direct-edge={edgeHandle.edge} data-strip-direct-anchor={edgeHandle.anchor.join(',')} aria-label="Trascina per duplicare il bordo libero"
      title="Trascina per duplicare il bordo libero">D</button></>}
  </div>
}
function dispose(o: THREE.Object3D) { const m = o as THREE.Mesh; if (!m.userData.borrowedGeometry) m.geometry?.dispose(); if (Array.isArray(m.material)) m.material.forEach(a => a.dispose()); else m.material?.dispose() }
