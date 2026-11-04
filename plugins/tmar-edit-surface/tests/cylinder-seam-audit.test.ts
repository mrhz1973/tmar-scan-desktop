// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { SurfaceEditorKernel } from '../editorKernel'
import { auditCylinderSeam } from '../cylinderSeam'
import { replaceSurface, surfaceTable } from '../brep'
import { moveSmoothCylinderPole, refineLinearPeriodicV } from '../periodic'

it.each([false,true])('audits both serialized seam curves on a converted STEP cylinder (rotated: %s)',async rotated=>{
  const editor=await SurfaceEditorKernel.load(),k=editor.kernel,primitive=k.makeCylinder(10,20)
  const rotatedBody=rotated?k.rotate(primitive,{point:{x:0,y:0,z:0},direction:{x:1,y:1,z:0}},.73):null
  const positioned=rotatedBody?k.translate(rotatedBody,7,-11,4):null
  const source=k.importStep(k.exportStep(positioned??primitive)),converted=k.generalTransform(source,[1,0,0,0,0,1,0,0,0,0,1,0])
  const text=k.toBREP(converted),record=surfaceTable(text).find(r=>r.periodicNet)!
  const edited=k.fromBREP(replaceSurface(text,record,moveSmoothCylinderPole(refineLinearPeriodicV(record.periodicNet!),[.5,0,0])))
  const reopened=k.importStep(k.exportStep(edited))
  try {
    for(const shape of [converted,edited,reopened]) {
      const faces=k.getSubShapes(shape,'face')
      try { expect(()=>auditCylinderSeam(k,faces[0])).not.toThrow() }
      finally { faces.forEach(face=>k.release(face)) }
    }
    const faces=k.getSubShapes(converted,'face')
    try {
      const faceText=k.toBREP(faces[0])
      const seam=/^3\s+(\d+)\s+(\d+)\s*(?:CN|C[0-9]|G[0-9])\s+(\d+)\s+\d+\s+([\deE+.-]+)\s+([\deE+.-]+)\s*$/m.exec(faceText)!
      expect(seam).toBeTruthy()
      const oneSided=faceText.replace(seam[0],seam[0].replace(/^3\s+\d+\s+\d+/,`3 ${seam[1]} ${seam[1]}`))
      const original=k.toBREP.bind(k), spy=vi.spyOn(k,'toBREP').mockReturnValueOnce(oneSided)
      expect(()=>auditCylinderSeam(k,faces[0])).toThrow(/Parametri/)
      spy.mockRestore()
      const table=/Curve2ds\s+(\d+)\s*\n([\s\S]*?)\nCurves\s+\d+/.exec(faceText)!
      const tokens=table[2].trim().split(/\s+/), count=Number(table[1]);let cursor=0
      for(let i=0;i<count;i++) {
        let type=Number(tokens[cursor++]);if(type===8){cursor+=2;type=Number(tokens[cursor++])}
        expect(type).toBe(7)
        const rational=Number(tokens[cursor++]);cursor+=2
        const poleCount=Number(tokens[cursor++]),knotCount=Number(tokens[cursor++])
        if(i===Number(seam[1])-1) tokens[cursor]=String(Number(tokens[cursor])+.1)
        cursor+=poleCount*(rational?3:2)+knotCount*2
      }
      const altered=faceText.slice(0,table.index)+table[0].replace(table[2],tokens.join(' '))+faceText.slice(table.index+table[0].length)
      vi.spyOn(k,'toBREP').mockReturnValueOnce(altered)
      expect(()=>auditCylinderSeam(k,faces[0])).toThrow(/non coincidono/)
      vi.restoreAllMocks()
      expect(original(converted)).toBe(text)
    } finally {faces.forEach(face=>k.release(face))}
  } finally { [reopened,edited,converted,source].forEach(h=>k.release(h));if(positioned)k.release(positioned);if(rotatedBody)k.release(rotatedBody);k.release(primitive);editor.dispose() }
},60000)
