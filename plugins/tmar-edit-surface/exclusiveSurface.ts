// SPDX-License-Identifier: AGPL-3.0-only
import { signature, surfaceTable, type RecordSpan } from './brep'

/** Identify the selected support in this exact BREP and fail closed if it is
 * ambiguous or referenced by another face. This checks serialized face
 * records, not repeated occurrences of the same TShape in an assembly. */
export function exclusiveFaceSurface(brep: string, faceBrep: string, faceCount: number): RecordSpan {
  const table=surfaceTable(brep), ownTable=surfaceTable(faceBrep)
  const headers=(text:string)=>[...text.matchAll(/^Fa\s*\n\s*[01]\s+[\deE+.-]+\s+(\d+)\s+0\s*$/gm)].map(m=>Number(m[1]))
  const own=headers(faceBrep), all=headers(brep)
  if (!Number.isInteger(faceCount) || faceCount<1 || own.length!==1 || all.length!==faceCount ||
      all.some(i=>!Number.isInteger(i)||i<1||i>table.length) || own[0]<1 || own[0]>ownTable.length)
    throw new Error('Riferimenti BREP delle facce non riconosciuti.')
  const matches=table.map((entry,index)=>({entry,index:index+1})).filter(x=>signature(x.entry)===signature(ownTable[own[0]-1]))
  if(matches.length!==1 || all.filter(index=>index===matches[0].index).length!==1)
    throw new Error('Superficie condivisa o identificazione ambigua.')
  return matches[0].entry
}
