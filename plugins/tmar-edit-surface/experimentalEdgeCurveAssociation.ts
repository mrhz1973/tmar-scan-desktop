// SPDX-License-Identifier: AGPL-3.0-only
// Experimental, fail-closed association of one serialized OCCT edge to one
// BREP V3 Curves-table record. This is deliberately not used by the editor.
import { curve3dTable, type Curve3dRecord } from './experimentalCurveWitness'

/** Structural association only. Pcurve geometry and face adjacency require a
 * separate gate; the counts below report parsed records, not certificates. */
export interface EdgeCurveAssociation {
  curveIndex: number
  range: [number, number]
  curve: Curve3dRecord
  pcurveCount: number
  continuityCount: number
}

function fail(reason: string): never { throw new Error(`Associazione edge-curva sperimentale rifiutata: ${reason}`) }
function number(s: string): number {
  const n = Number(s)
  if (!s.trim() || !Number.isFinite(n)) fail('numero BREP non finito')
  return n
}
function index(s: string, limit: number): number {
  const n = number(s)
  if (!Number.isSafeInteger(n) || n < 1 || n > limit) fail('indice curva BREP non valido')
  return n
}
function tableCount(text: string, name: string): number {
  const match = new RegExp(`^${name} (\\d+)\\s*$`, 'm').exec(text)
  if (!match) fail(`tabella ${name} assente`)
  const count = number(match[1])
  if (!Number.isSafeInteger(count) || count < 0 || count > 100000) fail(`conteggio ${name} non valido`)
  return count
}

/** Associates one untransformed Ed record and validates its serialized 2/4
 * representations structurally. It does not validate pcurve geometry or
 * prove that referenced faces are adjacent. */
export function associateSerializedEdgeCurve(text: string): EdgeCurveAssociation {
  if (!text.includes('CASCADE Topology V3') || !/^Locations 0\s*$/m.test(text)) fail('versione o trasformazioni non supportate')
  const curves = curve3dTable(text)
  const pcurveCount = tableCount(text, 'Curve2ds'), surfaceCount = tableCount(text, 'Surfaces')
  const edges = [...text.matchAll(/^Ed\s*\n([^\n]*)\n([\s\S]*?)^0\s*$/gm)]
  if (edges.length !== 1) fail('occorrenza del bordo ambigua')
  const header = edges[0][1].trim().split(/\s+/)
  if (header.length !== 4 || header[1] !== '1' || header[2] !== '1' || header[3] !== '0')
    fail('bordo degenere o senza SameParameter/SameRange verificabili')
  const tolerance = number(header[0])
  if (tolerance < 0 || tolerance > 1e-6) fail('tolleranza topologica oltre il limite')
  const representations: { index: number; range: [number, number] }[] = []
  const pcurves: { range: [number, number] }[] = []
  let continuityCount = 0
  for (const line of edges[0][2].trim().split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] === '1' && fields.length === 5) {
      const curveIndex = index(fields[1], curves.length)
      if (fields[2] !== '0') fail('rappresentazione 3D trasformata')
      const range: [number, number] = [number(fields[3]), number(fields[4])]
      if (!(range[1] > range[0])) fail('intervallo del bordo non valido')
      representations.push({ index: curveIndex, range })
    } else if (fields[0] === '2' && fields.length === 6) {
      index(fields[1], pcurveCount); index(fields[2], surfaceCount)
      if (fields[3] !== '0') fail('pcurve trasformata')
      const range: [number, number] = [number(fields[4]), number(fields[5])]
      if (!(range[1] > range[0])) fail('intervallo pcurve non valido')
      pcurves.push({ range })
    } else if (fields[0] === '4' && fields.length === 6 && /^(C0|C1|C2|C3|CN|G1|G2)$/.test(fields[1])) {
      index(fields[2], surfaceCount); index(fields[4], surfaceCount)
      if (fields[3] !== '0' || fields[5] !== '0') fail('continuità tra facce trasformata')
      continuityCount++
    } else fail('rappresentazione del bordo non supportata')
  }
  if (representations.length !== 1) fail('il bordo deve avere una sola rappresentazione 3D')
  const rep = representations[0], curve = curves[rep.index - 1]
  if (pcurves.some(p => !Object.is(p.range[0], rep.range[0]) || !Object.is(p.range[1], rep.range[1])))
    fail('intervallo pcurve diverso dall’intervallo 3D')
  if (curve.source !== 'curve-table' || curve.periodic) fail('curva non periodica della tabella non supportata')
  const domain: [number, number] = [curve.knots[0], curve.knots[curve.knots.length - 1]]
  if (!Object.is(rep.range[0], domain[0]) || !Object.is(rep.range[1], domain[1])) fail('il bordo non copre l’intero intervallo della curva')
  return { curveIndex: rep.index, range: rep.range, curve, pcurveCount: pcurves.length, continuityCount }
}
