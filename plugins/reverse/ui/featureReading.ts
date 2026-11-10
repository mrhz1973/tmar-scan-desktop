// SPDX-License-Identifier: AGPL-3.0-only
import { reverseText as tmarText } from '../../../src/i18n'

import { unitWord, type DisplayUnits } from '../../../src/core/units'
import { type ExtrudeExtent, type Feature, toolsOf } from '../core/features'
import { describePlaneRef } from '../core/resolve'
import { threadName } from '../core/thread'
import { describeEdgeIn, describeFaceIn } from '../core/topo'
import type { KeyIconName } from './reIcons'
import { lenBare, lenShort } from './reLength'

/** A file's size as a person reads it. */
export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? tmarText("{0} kB", [Math.max(1, Math.round(bytes / 1024))]) : tmarText("{0} MB", [(bytes / 1024 / 1024).toFixed(1)]))

/** The one number a feature row reads beside its body operation: how far
 *  an extrude reaches, how far a revolve turns. */
export function keyParameter(f: { kind: 'extrude'; extent: ExtrudeExtent } | { kind: 'revolve'; angleDeg: number }, units: DisplayUnits = 'mm'): string {
  if (f.kind === 'revolve') return tmarText("{0}°", [Math.round(f.angleDeg * 100) / 100])
  const e = f.extent
  switch (e.kind) {
    case 'distance':
      return lenShort(Math.abs(e.to - e.from), units)
    case 'symmetric':
      return lenShort(e.total, units)
    case 'toPlane':
      return tmarText("to a plane")
    case 'toFace':
      return tmarText("to a face")
    case 'toBody':
      return tmarText("to a body")
    case 'toNext':
      return tmarText("to next")
    case 'toLast':
      return tmarText("to last")
    case 'betweenPlanes':
      return tmarText("between planes")
  }
}

/** The icon each kind of feature carries in its row. */
export const FEATURE_ICONS: Record<Feature['kind'], KeyIconName> = {
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  shell: 'shell',
  fillet: 'fillet',
  chamfer: 'chamfer',
  hole: 'hole',
  // A thread is a screw of a profile about an axis — Revolve's picture, as
  // a coil's is; the key that starts one has a picture of its own.
  thread: 'revolve',
  extract: 'extract',
  cutPlane: 'cutPlane',
  mirror: 'mirror',
  boolean: 'combine',
  sheet: 'sheet',
  split: 'split',
  loft: 'loft',
  // A section carried along a path: a loft's picture is the nearest.
  sweep: 'loft',
  // A sheet made a wall: the wall of a shell is the nearest picture.
  thicken: 'shell',
  pattern: 'pattern',
  draft: 'draft',
  moveFace: 'moveFace',
  deleteFace: 'deleteFace',
  // A body grown all round: the wall of a shell is the nearest picture.
  offsetBody: 'shell',
  import: 'importStep',
  moveBody: 'moveBody',
  surface: 'surface',
  // Patches fitted to the scan: a fitted surface's picture.
  network: 'surface',
  trim: 'trim',
}

/** What a row reads for a feature on a body, and the tooltip behind it. */
export function bodyFeatureReading(f: Exclude<Feature, { kind: 'sketch' | 'extrude' | 'revolve' }>, names: (id: number) => string, ctx: { sections: readonly { id: number; name: string }[]; elements: readonly { id: number; name: string }[] }, units: DisplayUnits = 'mm'): { text: string; title: string } {
  /** A length with its unit, to the hundredth of a millimetre. */
  const len = (v: number) => lenShort(v, units)
  /** The same without the unit, where the unit follows a second figure. */
  const bare = (v: number) => lenBare(v, units, 2)
  const describeFace = describeFaceIn(units)
  const faceText: typeof describeFace = (face) => tmarText(describeFace(face))
  const describeEdge = describeEdgeIn(units)
  const edgeText: typeof describeEdge = (edge) => tmarText(describeEdge(edge))
  switch (f.kind) {
    case 'shell':
      return { text: tmarText("{0} wall", [len(f.thickness)]), title: tmarText("{0} hollowed to a {1} wall, {2} face{3} opened: {4}", [names(f.body), len(f.thickness), f.faces.length, f.faces.length === 1 ? '' : tmarText("s"), f.faces.map(faceText).join('; ')]) }
    case 'fillet': {
      const varying = f.variable ?? []
      const radii = [...(f.edges.length > 0 ? [tmarText("R {0}", [len(f.radius)])] : []), ...varying.map((v) => tmarText("R {0} → {1}", [bare(v.radius[0]), len(v.radius[1])]))]
      const plain = f.edges.length > 0 ? tmarText("{0} edge{1} of {2} rounded{3}: {4}", [f.edges.length, f.edges.length === 1 ? '' : tmarText("s"), names(f.body), f.chain ? tmarText(", tangent chains along") : '', f.edges.map(edgeText).join('; ')]) : ''
      const vary = varying.length > 0 ? tmarText("{0} edge{1}{2} rounded at a varying radius, start → end: {3}", [varying.length, varying.length === 1 ? '' : tmarText("s"), f.edges.length > 0 ? '' : tmarText(" of {0}", [names(f.body)]), varying.map((v) => tmarText("{0} {1} → {2}", [edgeText(v.edge), len(v.radius[0]), len(v.radius[1])])).join('; ')]) : ''
      return { text: radii.length > 2 ? tmarText("{0} · {1} more", [radii[0], radii.length - 1]) : radii.join(' · '), title: [plain, vary].filter(Boolean).join(tmarText("; and ")) }
    }
    case 'chamfer': {
      const size = f.mode === 'twoDistances' ? tmarText("{0} × {1}", [bare(f.distance), len(f.distance2 ?? f.distance)]) : f.mode === 'distanceAngle' ? tmarText("{0} × {1}°", [len(f.distance), Math.round((f.angleDeg ?? 45) * 100) / 100]) : len(f.distance)
      const how = f.mode === 'twoDistances' ? tmarText(", {0} on the reference face and {1} on the other{2}", [len(f.distance), len(f.distance2 ?? f.distance), f.flip ? tmarText(" (flipped)") : '']) : f.mode === 'distanceAngle' ? tmarText(", {0} on the reference face at {1}° to it{2}", [len(f.distance), f.angleDeg ?? 45, f.flip ? tmarText(" (flipped)") : '']) : ''
      return { text: size, title: tmarText("{0} edge{1} of {2} chamfered{3}{4}: {5}", [f.edges.length, f.edges.length === 1 ? '' : tmarText("s"), names(f.body), how, f.chain ? tmarText(", tangent chains along") : '', f.edges.map(edgeText).join('; ')]) }
    }
    case 'hole': {
      const axis = f.axis
      const along = axis.kind === 'element' ? tmarText("along {0}", [ctx.elements.find((e) => e.id === axis.id)?.name ?? tmarText("a deleted element")]) : axis.kind === 'point' ? tmarText("into {0} at its centre", [faceText(axis.face)]) : tmarText("along {0}", [faceText(axis.face)])
      return { text: tmarText("{0}Ø {1}{2}", [f.insert ? tmarText("{0} insert · ", [f.insert]) : '', len(2 * f.radius), f.depth === null ? tmarText(" through") : tmarText(" × {0}", [len(f.depth)])]), title: tmarText("A hole {0}in {1}, {2}", [f.insert ? tmarText("for an {0} heat-set insert ", [f.insert]) : '', names(f.body), along]) }
    }
    case 'thread': {
      const name = threadName(f.standard, f.diameter, f.pitch)
      const where = f.length === null ? tmarText("the whole face") : tmarText("{0} from {1} in", [len(f.length), len(f.start)])
      return { text: tmarText("{0}{1}{2}{3}", [name, f.leftHanded ? tmarText(" LH") : '', f.offset > 0 ? tmarText(" · −{0}", [len(f.offset)]) : '', f.chamfer ? ' · 45°' : '']), title: tmarText("A {0}-hand {1} thread on {2} of {3}, {4}{5}{6}", [f.leftHanded ? tmarText("left") : tmarText("right"), name, faceText(f.face), names(f.body), where, f.offset > 0 ? tmarText(", every face of it {0} into the material for clearance", [len(f.offset)]) : '', f.chamfer ? tmarText(", chamfered at 45° where it comes out of the body") : '']) }
    }
    case 'extract': {
      const op = f.op === 'new' ? tmarText("New body") : f.op === 'join' ? tmarText("Join") : tmarText("Cut")
      if (f.section !== undefined) return { text: tmarText("{0} · {1}", [op, ctx.sections.find((x) => x.id === f.section)?.name ?? tmarText("deleted section")]), title: tmarText("The shadow section’s outline stood up through the part’s thickness") }
      return { text: tmarText("{0} · {1}", [op, ctx.elements.find((e) => e.id === f.element)?.name ?? tmarText("deleted element")]), title: tmarText("The element as a solid at its fitted extents{0}", [f.thickness > 0 ? tmarText(", a plane as a {0} slab", [len(f.thickness)]) : '']) }
    }
    case 'cutPlane':
      return { text: tmarText("at {0}", [describePlaneRef(f.plane, ctx, units)]), title: tmarText("{0} cut at the plane, the side {1} its normal kept", [names(f.body), f.keep > 0 ? tmarText("along") : tmarText("against")]) }
    case 'mirror':
      return { text: tmarText("about {0}{1}", [f.plane.kind === 'face' ? faceText(f.plane.face) : describePlaneRef(f.plane, ctx, units), f.join ? tmarText(" · joined") : '']), title: tmarText("{0} mirrored{1}", [names(f.body), f.join ? tmarText(" and joined with the source") : tmarText(" into a body of its own")]) }
    case 'boolean': {
      const tools = toolsOf(f).map(names).join(', ')
      const one = toolsOf(f).length === 1
      return { text: tmarText("{0} {1}{2}", [f.op === 'join' ? tmarText("Join") : f.op === 'cut' ? tmarText("Cut") : tmarText("Intersect"), tools, f.keep ? tmarText(" · kept") : '']), title: tmarText("{0} {1} {2}{3}, {4}", [names(f.body), f.op === 'join' ? tmarText("joined with") : f.op === 'cut' ? tmarText("cut by") : tmarText("intersected with"), tools, !one && f.op !== 'join' ? tmarText(" in turn") : '', f.keep ? tmarText("which stay{0} {1} of {2} own", [one ? tmarText("s") : '', one ? tmarText("a body") : tmarText("bodies"), one ? tmarText("its") : tmarText("their")]) : tmarText("which go{0} into it", [one ? tmarText("es") : ''])]) }
    }
    case 'sheet':
      return { text: tmarText("Surface · {0}", [len(Math.abs(f.to - f.from))]), title: tmarText("{0}'s pieces extruded as a surface from {1} to {2} along its normal — a cutter, not exported on its own", [names(f.sketchId), len(f.from), len(f.to)]) }
    case 'split':
      return { text: tmarText("by {0} · {1}", [f.tools.map(names).join(', '), f.keep === 'scan' ? tmarText("on the scan") : tmarText(f.keep)]), title: tmarText("{0} split by {1}, the fragments {2} kept", [names(f.body), f.tools.map(names).join(', '), f.keep === 'scan' ? tmarText("lying on the scan within {0} over {1} % of their faces", [len(f.tolerance), Math.round(f.overlap * 100)]) : f.keep === 'between' ? tmarText("lying between the sheets") : tmarText("the {0}", [tmarText(f.keep)])]) }
    case 'loft':
      return { text: tmarText("{0} · {1} sketches{2}", [f.op === 'new' ? tmarText("New body") : f.op === 'join' ? tmarText("Join") : tmarText("Cut"), f.sketches.length, f.ruled ? '' : tmarText(", smooth")]), title: tmarText("A {0} loft through {1}", [f.ruled ? tmarText("ruled") : tmarText("smooth"), f.sketches.map(names).join(', ')]) }
    case 'sweep':
      if (f.route) {
        const bends = f.route.points.length - 2
        return { text: tmarText("{0} · 3D route, {1} bend{2}", [f.op === 'new' ? tmarText("New body") : f.op === 'join' ? tmarText("Join") : tmarText("Cut"), bends, bends === 1 ? '' : tmarText("s")]), title: tmarText("{0}'s largest region swept along a route of {1} points in 3D, bends of radius {2}{3}", [names(f.profile), f.route.points.length, len(f.route.bendRadius), f.route.radii?.some((r) => r !== null) ? tmarText(" or their own") : '']) }
      }
      return { text: tmarText("{0} · along {1}", [f.op === 'new' ? tmarText("New body") : f.op === 'join' ? tmarText("Join") : tmarText("Cut"), names(f.path!)]), title: tmarText("{0}'s largest region swept along {1}", [names(f.profile), names(f.path!)]) }
    case 'thicken':
      return { text: tmarText("{0} · {1} {2}", [f.op === 'new' ? tmarText("New body") : f.op === 'join' ? tmarText("Join") : tmarText("Cut"), len(f.thickness), tmarText(f.side)]), title: tmarText("{0} made a solid {1} thick, {2}{3}", [names(f.sheet), len(f.thickness), f.side === 'out' ? tmarText("along its normal") : f.side === 'in' ? tmarText("against its normal") : tmarText("half each way"), f.op === 'new' ? tmarText(", a body of its own") : f.op === 'join' ? tmarText(", joined to what it meets") : tmarText(", cut from what it meets")]) }
    case 'draft':
      return { text: tmarText("{0}° · {1} face{2}", [Math.round(f.angleDeg * 100) / 100, f.faces.length, f.faces.length === 1 ? '' : tmarText("s")]), title: tmarText("{0} face{1} of {2} leaned {3}° about {4}: {5}", [f.faces.length, f.faces.length === 1 ? '' : tmarText("s"), names(f.body), f.angleDeg, f.neutral.kind === 'face' ? faceText(f.neutral.face) : describePlaneRef(f.neutral, ctx, units), f.faces.map(faceText).join('; ')]) }
    case 'moveFace': {
      const sign = tmarText("{0}{1}", [f.offset >= 0 ? '+' : '−', len(Math.abs(f.offset))])
      if (f.faces.length !== 1) return { text: tmarText("{0} · {1} faces", [sign, f.faces.length]), title: tmarText("{0} faces of {1} offset by {2} — the flat ones along their outward normals, the round ones in radius: {3}", [f.faces.length, names(f.body), len(f.offset), f.faces.map(faceText).join('; ')]) }
      const face = f.faces[0]
      return { text: sign, title: tmarText("{0} of {1} {2}", [faceText(face), names(f.body), face.kind === 'cylinder' ? tmarText("resized by {0} in radius", [len(f.offset)]) : tmarText("moved {0} {1} along its normal", [len(Math.abs(f.offset)), f.offset >= 0 ? tmarText("outward") : tmarText("inward")])]) }
    }
    case 'deleteFace':
      return { text: tmarText("{0} face{1}", [f.faces.length, f.faces.length === 1 ? '' : tmarText("s")]), title: tmarText("{0} face{1} taken off {2}, the faces round them run on over the gap: {3}", [f.faces.length, f.faces.length === 1 ? '' : tmarText("s"), names(f.body), f.faces.map(faceText).join('; ')]) }
    case 'pattern':
      return f.mode === 'linear' && f.axis2 && (f.count2 ?? 1) > 1
        ? { text: tmarText("{0} × {1} · {2} × {3}", [f.count, f.count2, len(f.step), len(f.step2 ?? 0)]), title: tmarText("{0} in a grid: {1} along its first direction every {2}, {3} rows every {4}", [names(f.body), f.count, len(f.step), f.count2, len(f.step2 ?? 0)]) }
        : { text: tmarText("{0} × {1}", [f.count, f.mode === 'circular' ? tmarText("over {0}°", [Math.round(f.step * 100) / 100]) : tmarText("every {0}", [len(f.step)])]), title: tmarText("{0} {1} its axis, {2} in all", [names(f.body), f.mode === 'circular' ? tmarText("turned about") : tmarText("stepped along"), f.count]) }
    case 'offsetBody':
      return { text: tmarText("{0}{1}{2}", [f.distance >= 0 ? '+' : '−', len(Math.abs(f.distance)), f.keep ? tmarText(" · new body") : '']), title: tmarText("{0} {1} {2} all round{3}", [names(f.body), f.distance >= 0 ? tmarText("grown") : tmarText("shrunk"), len(Math.abs(f.distance)), f.keep ? tmarText(", the body kept as it was and the offset a body of its own") : '']) }
    case 'trim':
      return { text: tmarText("{0} surface{1} · within {2}", [f.tools.length, f.tools.length === 1 ? '' : tmarText("s"), len(f.tolerance)]), title: tmarText("A box round the scan cut by {0}; the faces lying on the scan within {1} over {2} % of their samples kept and sewn", [f.tools.map((t) => (t.kind === 'body' ? names(t.id) : (ctx.elements.find((e) => e.id === t.id)?.name ?? tmarText("a deleted element")))).join(', '), len(f.tolerance), Math.round(f.overlap * 100)]) }
    case 'import':
      return { text: f.file.name, title: tmarText("{0} imported — {1}: a body for every solid in it, named as the file names its parts", [f.file.name, fileSize(f.file.size)]) }
    case 'moveBody':
      return moveReading(f, names, units)
    case 'network': {
      const curves = f.curves.length
      const cells = f.cells.length
      return { text: tmarText("{0} patch{1} · {2} curve{3}", [cells, cells === 1 ? '' : tmarText("es"), curves, curves === 1 ? '' : tmarText("s")]), title: tmarText("A patch network: {0} curve{1} drawn on the scan, {2} of them creases, and {3} region{4} they close filled with B-spline patches fitted to the scan together — sharing the curves between them and meeting tangent across every one not marked a crease. A sheet, or a solid where the network closes", [curves, curves === 1 ? '' : tmarText("s"), f.curves.filter((c) => c.crease).length, cells, cells === 1 ? '' : tmarText("s")]) }
    }
    case 'surface':
      return { text: tmarText("Surface · {0} points", [f.region.length.toLocaleString('en-US')]), title: tmarText("A freeform surface fitted through {0} points of the scan — a {1} net of degree {2}, reaching {3} % past the region. A surface body: trimmed with the others into a solid, not exported on its own", [f.region.length.toLocaleString('en-US'), f.fit.net ? tmarText("{0} × {1}", [f.fit.net.u, f.fit.net.v]) : tmarText("self-sized"), f.fit.degree, f.fit.expandPct]) }
  }
}

/** What a Move's row reads: Copy where it copies, how far it carries the
 *  bodies, and the turn — the angle where it turns about one axis. */
function moveReading(f: Extract<Feature, { kind: 'moveBody' }>, names: (id: number) => string, units: DisplayUnits): { text: string; title: string } {
  const round = (v: number) => Math.round(v * 100) / 100
  const bare = (v: number) => lenBare(v, units, 2)
  const length = Math.hypot(...f.translate)
  const turns = f.rotate.filter((v) => v !== 0)
  const words = [length > 0 ? lenShort(length, units) : null, turns.length === 1 ? tmarText("{0}°", [round(turns[0])]) : turns.length > 1 ? tmarText("turned") : null].filter((w): w is string => w !== null)
  const text = tmarText("{0}{1}", [f.copy ? tmarText("Copy · ") : '', words.join(' · ') || tmarText("in place")])
  const who = f.bodies.length === 1 ? names(f.bodies[0]) : tmarText("{0} bodies", [f.bodies.length])
  const done = [length > 0 ? tmarText("carried {0} {1} along X, Y, Z", [f.translate.map(bare).join(', '), unitWord(units)]) : null, turns.length > 0 ? tmarText("turned {0}° about X, Y and Z through {1}", [f.rotate.map(round).join(', '), f.pivot.map(bare).join(', ')]) : null].filter((w): w is string => w !== null)
  return { text, title: tmarText("{0}{1} {2}", [who, f.copy ? tmarText(" copied, the copy") : '', done.join(tmarText(", then ")) || tmarText("left where it stood")]) }
}
