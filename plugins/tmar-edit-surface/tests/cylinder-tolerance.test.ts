// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { assertMatchedCylinderTolerances } from '../cylinderTolerance'
import { assertToleranceDistribution } from '../cylinderPreparation'

it('detects an increase on a matched edge even when the sorted distribution is unchanged',async()=>{
  const e=await SurfaceEditorKernel.load(),k=e.kernel,p=k.makeCylinder(10,20),source=k.importStep(k.exportStep(p))
  const converted=k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  const before=k.getSubShapes(source,'edge'),after=k.getSubShapes(converted,'edge')
  try {
    expect(()=>assertMatchedCylinderTolerances(k,source,converted)).not.toThrow()
    const x='Ed\n1e-7\nEd\n1e-5\nVe\n1e-7\n',y='Ed\n1e-5\nEd\n1e-7\nVe\n1e-7\n'
    expect(()=>assertToleranceDistribution(x,y)).not.toThrow()
    const original=k.toBREP.bind(k)
    const spy=vi.spyOn(k,'toBREP').mockImplementation(handle=>{
      const raw=original(handle)
      if(k.isSame(handle,before[1])||k.isSame(handle,after[0])) return raw.replace(/^(Ed\s*\n\s*)[\deE+.-]+/m,(_,prefix)=>prefix+'1e-5')
      return raw
    })
    try { expect(()=>assertMatchedCylinderTolerances(k,source,converted)).toThrow(/aumentata/) }
    finally {spy.mockRestore()}
  } finally {[...before,...after].forEach(h=>k.release(h));k.release(converted);k.release(source);k.release(p);e.dispose()}
},60000)
