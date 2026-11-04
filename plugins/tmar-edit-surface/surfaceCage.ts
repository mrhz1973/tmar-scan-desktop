// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { Net } from './brep'
import { dragDirection, type DragMode } from './localFrame'
import { netEdges } from './netSelection'

export interface SurfaceCageOptions {
  net: Net
  selected: readonly number[]
  locked: readonly number[]
  hiddenPoles: readonly number[]
  showNet: boolean
  dragMode: DragMode
  axis: number
  mirrorAxis: number
  mirrorOffset: number
  mirrorPartners: readonly number[] | null
  radius: number
}

/** Draw into an empty group in the same local frame as the control net.
 * The caller owns the group and must dispose its children when replacing it. */
export function populateSurfaceCage(cage: THREE.Group, options: SurfaceCageOptions): void {
  const { net: n, selected, locked, hiddenPoles, showNet, dragMode, axis, mirrorAxis, mirrorOffset, mirrorPartners, radius } = options
  const hidden = new Set(hiddenPoles)
  const mirrored = new Set<number>()
  if (mirrorPartners) {
    for (const i of selected) {
      const j = mirrorPartners[i]
      if (j >= 0 && !locked.includes(i) && !locked.includes(j)) mirrored.add(j)
    }
    const u = (mirrorAxis + 1) % 3, v = (mirrorAxis + 2) % 3
    const box = new THREE.Box3().setFromPoints(n.poles.map(p => new THREE.Vector3(...p)))
    const pad = radius * 0.08
    const corners = [[0,0], [1,0], [1,1], [0,1]].map(([highU, highV]) => {
      const corner = new THREE.Vector3()
      corner.setComponent(mirrorAxis, mirrorOffset)
      corner.setComponent(u, highU ? box.max.getComponent(u) + pad : box.min.getComponent(u) - pad)
      corner.setComponent(v, highV ? box.max.getComponent(v) + pad : box.min.getComponent(v) - pad)
      return corner
    })
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners),
      new THREE.LineBasicMaterial({ color: '#f785ff', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }))
    frame.renderOrder = 3
    cage.add(frame)
  }
  n.poles.forEach((p, i) => {
    if (hidden.has(i)) return
    const color = selected.includes(i) ? '#ffcf35' : locked.includes(i) ? '#89939c' : mirrored.has(i) ? '#f785ff' : '#58f3d0'
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.012, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false }))
    mesh.position.set(...p); mesh.userData.point = i; mesh.renderOrder = 5; cage.add(mesh)
    // Picking can run before the next render after the cage is rebuilt.
    mesh.updateWorldMatrix(true, false)
  })
  const anchor = selected.find(i => !locked.includes(i) && !hidden.has(i))
  if (anchor !== undefined && dragMode !== 'screen') {
    const direction = dragDirection(n, anchor, dragMode, axis)
    if (direction) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(...direction), new THREE.Vector3(...n.poles[anchor]), radius * 0.22, 0xffcf35, radius * 0.045, radius * 0.025)
      // ArrowHelper shares default geometry globally; each cage owns only its clones.
      arrow.line.geometry = arrow.line.geometry.clone(); arrow.cone.geometry = arrow.cone.geometry.clone()
      arrow.traverse(o => { const m = o as THREE.Mesh; if (m.material && !Array.isArray(m.material)) { m.material.transparent = true; m.material.depthTest = false; m.material.depthWrite = false }; o.renderOrder = 6 })
      cage.add(arrow)
    }
  }
  if (!showNet) return // Hide the connecting cage, retain editable poles.
  const lines: number[] = [], colors: number[] = []
  for (const [a, b] of netEdges(n)) {
    if (hidden.has(a) || hidden.has(b)) continue
    lines.push(...n.poles[a], ...n.poles[b])
    const c = new THREE.Color(selected.includes(a) && selected.includes(b) ? '#ffcf35' : '#95e7ea')
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false })); line.renderOrder = 4; cage.add(line)
}
