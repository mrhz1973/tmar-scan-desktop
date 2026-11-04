// SPDX-License-Identifier: AGPL-3.0-only
import type { Mesh, OcctKernel } from 'occt-wasm'
import { replaceSurface, surfaceTable, type Net } from './brep'
import { assertSmoothCylinderMove } from './periodic'

/** Display-only tessellation. It does not validate the shape, qualify the
 * source, export CAD or authorize Apply. Run in the CAD worker, not on the
 * UI thread; the current revision must still pass evaluatePreparedCylinder. */
export function previewPreparedCylinder(k: OcctKernel, prepared: {brep:string; net:Net}, candidate: Net): {kind:'provisional'; mesh:Mesh; faceMeshes:Mesh[]} {
  assertSmoothCylinderMove(prepared.net, candidate)
  const entries=surfaceTable(prepared.brep).filter(r=>r.periodicNet)
  if(entries.length!==1 || JSON.stringify(entries[0].periodicNet)!==JSON.stringify(prepared.net))
    throw new Error('Base cilindrica non corrispondente.')
  const shape=k.fromBREP(replaceSurface(prepared.brep,entries[0],candidate))
  try {
    const faces=k.getSubShapes(shape,'face')
    try {return {kind:'provisional',mesh:k.tessellate(shape,{linearDeflection:.08,angularDeflection:.15}),
      faceMeshes:faces.map(face=>k.tessellate(face,{linearDeflection:.08,angularDeflection:.15}))}}
    finally {faces.forEach(face=>k.release(face))}
  }
  finally { k.release(shape) }
}
