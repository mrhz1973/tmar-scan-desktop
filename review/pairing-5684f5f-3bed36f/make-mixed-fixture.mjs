// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic test data only; no user file or production source is modified.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { OcctKernel } from 'occt-wasm'
assert.equal(process.env.SCANRULER_ISOLATED, '1')
const out = process.env.OUT_DIR
assert(out && isAbsolute(out))
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init(), owned = []
const own = value => { owned.push(value); return value }
try {
  const p = (x, y) => ({ x, y, z: 0 })
  const spline = own(k.makeBSplineEdge([0,0,0, 3,-1,0, 7,-1,0, 10,0,0], [], [0,1], [4,4], 3))
  const a = own(k.makeLineEdge(p(10,0), p(10,10)))
  const b = own(k.makeLineEdge(p(10,10), p(0,10)))
  const c = own(k.makeLineEdge(p(0,10), p(0,0)))
  const wire = own(k.makeWire([spline,a,b,c])), face = own(k.makeFace(wire))
  const solid = own(k.extrude(face,0,0,10))
  assert(k.isValid(solid), 'Synthetic input must be valid')
  const text = k.exportStep(solid), reread = own(k.importStep(text))
  const faces = k.getSubShapes(reread, 'face')
  try {
    const kinds = faces.map(f => k.surfaceType(f))
    assert(kinds.includes('extrusion') && kinds.includes('plane'))
    writeFileSync(join(out, 'mixed-extrusion.step'), text)
    writeFileSync(join(out, 'fixture.json'), JSON.stringify({
      scope: 'Synthetic solid; rectangular eligible faces beside preserved spline extrusion',
      sha256: createHash('sha256').update(text).digest('hex'), valid: k.isValid(reread),
      volume: k.getVolume(reread), faceKinds: kinds,
    }, null, 2))
  } finally { faces.forEach(f => k.release(f)) }
} finally { owned.reverse().forEach(h => k.release(h)); k[Symbol.dispose]() }
