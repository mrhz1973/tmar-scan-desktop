// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'

it('checks a native cylinder conversion against STEP edge geometry before enabling it', async () => {
  const editor=await SurfaceEditorKernel.load(), k=editor.kernel, primitive=k.makeCylinder(10,20)
  const source=k.importStep(k.exportStep(primitive)), converted=k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  const reopened=k.importStep(k.exportStep(converted))
  try {
    expect(k.isValid(source)).toBe(true); expect(k.isValid(converted)).toBe(true); expect(k.isValid(reopened)).toBe(true)
    for(const kind of ['solid','face','edge','vertex'] as const) {
      const a=k.getSubShapes(source,kind),b=k.getSubShapes(converted,kind),c=k.getSubShapes(reopened,kind)
      try { expect(b.length).toBe(a.length); expect(c.length).toBe(a.length) }
      finally { [...a,...b,...c].forEach(h=>k.release(h)) }
    }
    const a=k.getSubShapes(source,'face'), b=k.getSubShapes(converted,'face'), c=k.getSubShapes(reopened,'face')
    try {
      for(let f=0;f<a.length;f++) {
        expect(k.shapeOrientation(b[f])).toBe(k.shapeOrientation(a[f]))
        expect(k.shapeOrientation(c[f])).toBe(k.shapeOrientation(a[f]))
        for(const [from,to] of [[a[f],b[f]],[b[f],a[f]],[a[f],c[f]],[c[f],a[f]]] as const) {
          const originalEdges=k.getSubShapes(from,'edge'), targetEdges=k.getSubShapes(to,'edge')
          try { for(const edge of originalEdges) {
            const range=k.curveParameters(edge)
            for(let i=0;i<=16;i++) {
              const p=k.curvePointAtParam(edge,range.first+(range.last-range.first)*i/16)
              const vertex=k.makeVertex(p.x,p.y,p.z)
              try { expect(Math.min(...targetEdges.map(x=>k.distanceBetween(vertex,x)))).toBeLessThan(1e-6) }
              finally { k.release(vertex) }
            }
          } } finally { [...originalEdges,...targetEdges].forEach(h=>k.release(h)) }
        }
        const bounds=k.uvBounds(a[f])
        for(let i=0;i<=8;i++) for(let j=0;j<=8;j++) {
          const u=bounds.uMin+(bounds.uMax-bounds.uMin)*i/8, v=bounds.vMin+(bounds.vMax-bounds.vMin)*j/8
          if(k.classifyPointOnFace(a[f],u,v)==='out') continue
          const p=k.pointOnSurface(a[f],u,v), n=k.surfaceNormal(a[f],u,v)
          for(const target of [b[f],c[f]]) {
            const q=k.projectPointOnFace(target,p), uv=k.uvFromPoint(target,p), m=k.surfaceNormal(target,uv.u,uv.v)
            expect(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)).toBeLessThan(1e-6)
            expect(n.x*m.x+n.y*m.y+n.z*m.z).toBeGreaterThan(1-1e-7)
          }
        }
      }
    } finally { [...a,...b,...c].forEach(h=>k.release(h)) }
  } finally { k.release(reopened);k.release(converted);k.release(source);k.release(primitive);editor.dispose() }
},60000)
