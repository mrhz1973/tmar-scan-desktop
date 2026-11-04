// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

/** Sample the two serialized pcurves against the same 3D seam edge. This is a
 * deliberately restricted BREP-V3 reader for the clamped quadratic seam
 * emitted by the tested cylinder conversion. Unknown encodings are refused.
 * Passing finite samples is not a global proof or permission to edit a face.
 * The 3D edge is matched by its parameter interval, not TShape identity;
 * coincident or overlapping edges therefore remain an unresolved ambiguity.
 * This helper is diagnostic only and is not wired into production editing. */
export function auditCylinderSeam(k: OcctKernel, face: ShapeHandle): void {
  const text = k.toBREP(face)
  if (!text.includes('CASCADE Topology V3') || !/^Locations 0\s*$/m.test(text)) throw new Error('Formato cucitura non supportato.')
  const table = /Curve2ds\s+(\d+)\s*\n([\s\S]*?)\nCurves\s+\d+/.exec(text)
  if (!table || Number(table[1]) < 1 || Number(table[1]) > 10000) throw new Error('Tabella delle curve 2D non supportata.')
  const values = table[2].trim().split(/\s+/).map(Number)
  let pos = 0
  const take = () => { const n = values[pos++]; if (!Number.isFinite(n)) throw new Error('Curva 2D non valida.'); return n }
  const curves = Array.from({ length: Number(table[1]) }, () => {
    let type = take(), first: number | undefined, last: number | undefined
    if (type === 8) { first = take(); last = take(); type = take() }
    if (type !== 7) throw new Error('Curva 2D non supportata.')
    const rational=take(),periodic=take(),degree=take(),count=take(),kcount=take()
    if (![0,1].includes(rational) || ![0,1].includes(periodic) || !Number.isInteger(degree) || degree<1 || degree>25 ||
        !Number.isInteger(count) || count<2 || count>25000 || !Number.isInteger(kcount) || kcount<2 || kcount>25000)
      throw new Error('Dimensioni della curva 2D non supportate.')
    const poles = Array.from({ length: count }, () => { const x=take(),y=take(),w=rational?take():1; return {x,y,w} })
    const knots = Array.from({ length: kcount }, () => ({ value:take(), multiplicity:take() }))
    return { poles, knots, rational, periodic, degree, first: first ?? knots[0].value, last: last ?? knots.at(-1)!.value }
  })
  if (pos !== values.length) throw new Error('Dati inattesi nelle curve 2D.')
  const seams = [...text.matchAll(/^3\s+(\d+)\s+(\d+)\s*(?:CN|C[0-9]|G[0-9])\s+(\d+)\s+\d+\s+([\deE+.-]+)\s+([\deE+.-]+)\s*$/gm)]
  if (seams.length !== 1) throw new Error('Cucitura doppia non identificata univocamente.')
  const seam = seams[0], first = Number(seam[4]), last = Number(seam[5])
  const headers = [...text.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)]
  if (headers.length !== 1 || Number(headers[0][1]) !== Number(seam[3])) throw new Error('Cucitura associata a una superficie diversa.')
  const selected = [curves[Number(seam[1])-1], curves[Number(seam[2])-1]]
  if (selected.some(c => !c) || Number(seam[1]) === Number(seam[2]) || !Number.isFinite(first) || !Number.isFinite(last) || last <= first)
    throw new Error('Parametri della cucitura non validi.')
  const scale = Math.max(1, Math.abs(first), Math.abs(last)), close = (a:number,b:number) => Math.abs(a-b) <= 1e-9*scale
  if (selected.some(c => c.rational!==0 || c.periodic!==0 || c.degree!==2 || c.poles.length!==3 || c.knots.length!==2 ||
      c.knots[0].multiplicity!==3 || c.knots[1].multiplicity!==3 || !close(c.first, first) || !close(c.last, last) ||
      !close(c.knots[0].value, first) || !close(c.knots[1].value, last)))
    throw new Error('Parametrizzazione della cucitura non corrispondente.')
  const edges = k.getSubShapes(face, 'edge')
  try {
    const matches = edges.filter(edge => { const t = k.curveParameters(edge); return close(t.first, first) && close(t.last, last) })
    if (matches.length !== 1) throw new Error('Bordo 3D della cucitura ambiguo.')
    for (const curve of selected) for (let i=0; i<=64; i++) {
      const s = i/64, t = first+(last-first)*s, p = curve.poles
      const u = (1-s)**2*p[0].x+2*s*(1-s)*p[1].x+s*s*p[2].x
      const v = (1-s)**2*p[0].y+2*s*(1-s)*p[1].y+s*s*p[2].y
      const a = k.curvePointAtParam(matches[0], t), b = k.pointOnSurface(face, u, v)
      const delta = Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)
      if (!Number.isFinite(delta) || delta > 1e-6) throw new Error('Cucitura 2D e bordo 3D non coincidono.')
    }
  } finally { edges.forEach(edge => k.release(edge)) }
}
