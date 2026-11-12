// SPDX-License-Identifier: AGPL-3.0-only
import type { Language } from '../../src/i18n'

export const SURFACE_TOOLS = ['select','move','modify','edges','analysis','history'] as const
export type SurfaceTool = typeof SURFACE_TOOLS[number]
const entries: Record<SurfaceTool, {italian:string;english:string;icon:string;summaryIt:string;summaryEn:string;className:string}> = {
  select:{italian:'Seleziona',english:'Select',icon:'⌖',summaryIt:'Punti e gruppi',summaryEn:'Points and groups',className:'select'},
  move:{italian:'Sposta',english:'Move',icon:'✥',summaryIt:'Gizmo X/Y/Z e quote',summaryEn:'3D gizmo and dimensions',className:'move'},
  modify:{italian:'Modifica',english:'Modify',icon:'◩',summaryIt:'Forma e simmetria',summaryEn:'Shape and symmetry',className:'modify'},
  edges:{italian:'Bordi/Vincoli',english:'Edges/Constraints',icon:'⌁',summaryIt:'G0, G1 e bordi',summaryEn:'G0, G1, boundaries',className:'edges'},
  analysis:{italian:'Analisi',english:'Analysis',icon:'◉',summaryIt:'Reticolo, zebra e note',summaryEn:'Net, zebra and notes',className:'analysis'},
  history:{italian:'Cronologia',english:'History',icon:'↶',summaryIt:'Annulla e ripristina',summaryEn:'Undo and restore',className:'history'},
}
export function surfaceToolInfo(tool:SurfaceTool,language:Language) {
  const item=entries[tool]
  return {...item,title:language === 'en' ? item.english : item.italian,
    summary:language === 'en' ? item.summaryEn : item.summaryIt}
}
