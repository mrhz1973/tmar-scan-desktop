// SPDX-License-Identifier: AGPL-3.0-only
// Parameter-domain regression, not a CAD ownership or geometric qualification.
import {describe,expect,it} from 'vitest'
import {assertCompleteDegree1PcurveDomain as assertDomain} from '../compatibleCurvedSupportTopology'

describe('degree-1 pcurve full-domain wrapper guard used by production',()=>{
  it.each([1,1e-20,1e20])('refuses partial inner wrappers independently of parameter scale %s',scale=>{
    const knots:[number,number]=[0,scale],range:[number,number]=[0,scale]
    const full:[number,number]=[0,scale],partial:[number,number]=[scale/4,3*scale/4]
    const saved={knots:[...knots],range:[...range],full:[...full],partial:[...partial]}
    expect(()=>assertDomain(knots,range,[])).not.toThrow()
    expect(()=>assertDomain(knots,range,[full])).not.toThrow()
    expect(()=>assertDomain(knots,range,[[-scale,2*scale],full])).not.toThrow()
    expect(()=>assertDomain(knots,range,[partial])).toThrow()
    expect(()=>assertDomain(knots,range,[full,partial])).toThrow()
    expect(()=>assertDomain(knots,range,[[scale/4,scale]])).toThrow()
    expect(()=>assertDomain(knots,range,[[0,3*scale/4]])).toThrow()
    expect({knots,range,full,partial}).toEqual(saved)
  })

  it('rejects partial use of the segment even if wrapper containment would pass',()=>{
    expect(()=>assertDomain([0,1e-20],[0,7.5e-21],[[0,1e-20]])).toThrow()
    expect(()=>assertDomain([0,1e-20],[2.5e-21,1e-20],[[0,1e-20]])).toThrow()
  })

  it('rejects malformed parameter intervals without accepting NaN, infinities or sparse data',()=>{
    const invalid:unknown[]=[[0,0],[1,0],[0,NaN],[0,Infinity],[0],new Array(2),null]
    for(const value of invalid){
      expect(()=>assertDomain(value as [number,number],[0,1])).toThrow()
      expect(()=>assertDomain([0,1],value as [number,number])).toThrow()
      expect(()=>assertDomain([0,1],[0,1],[value as [number,number]])).toThrow()
    }
  })
})
