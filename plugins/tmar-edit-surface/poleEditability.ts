// SPDX-License-Identifier: AGPL-3.0-only
// Read-only policy for explaining pole constraints; never changes geometry.
import { boundaryLocked, type Net } from './brep'

export type PoleLockReason = 'editable' | 'hidden' | 'trim' | 'manual' |
  'g1-tangent-ring' | 'g1-boundary' | 'g0-boundary'

export interface PoleLockState {
  reasons: PoleLockReason[]
  locked: number[]
  editable: number[]
}
export interface PoleLockInputs {
  continuity: 'G0' | 'G1'
  freeBoundary: boolean
  trimLocks: readonly number[]
  manualLocks: readonly number[]
  hiddenPoles: readonly number[]
}

export function evaluatePoleLockState(net: Net, inputs: PoleLockInputs): PoleLockState {
  const trim = new Set(inputs.trimLocks)
  const manual = new Set(inputs.manualLocks)
  const hidden = new Set(inputs.hiddenPoles)
  const reasons = net.poles.map((_, i): PoleLockReason => {
    // Never present geometric mode changes as a way to bypass explicit locks.
    if (hidden.has(i)) return 'hidden'
    if (trim.has(i)) return 'trim'
    if (manual.has(i)) return 'manual'
    if (inputs.freeBoundary) return 'editable'
    if (!boundaryLocked(net, i, inputs.continuity)) return 'editable'
    if (boundaryLocked(net, i, 'G0')) return inputs.continuity === 'G1' ? 'g1-boundary' : 'g0-boundary'
    return 'g1-tangent-ring'
  })
  const locked: number[] = [], editable: number[] = []
  reasons.forEach((reason, index) => (reason === 'editable' ? editable : locked).push(index))
  return { reasons, locked, editable }
}

export const poleLockExplanation: Record<PoleLockReason, string> = {
  editable: 'Libero: puoi trascinare il polo o usare una quota.',
  hidden: 'Fuori dal dominio visibile: influenza una zona protetta della superficie.',
  trim: 'Protezione ritaglio: questo polo influenza un contorno rifilato.',
  manual: 'Blocco manuale o imposto da un vincolo di tangenza.',
  'g1-tangent-ring': 'G1: prima fila interna protetta per mantenere la tangente al bordo.',
  'g1-boundary': 'G1: bordo protetto per conservare posizione e tangente.',
  'g0-boundary': 'G0: bordo protetto per conservare posizione e cucitura.',
}
export type PoleUnlockMode = 'g0' | 'free' | null
export function suggestedPoleUnlock(reason: PoleLockReason, canUseG0: boolean,
  canUseFreeBoundary: boolean): PoleUnlockMode {
  if (reason === 'g1-tangent-ring' && canUseG0) return 'g0'
  if ((reason === 'g1-boundary' || reason === 'g0-boundary') && canUseFreeBoundary) return 'free'
  return null
}

export const poleLockExplanationEn: Record<PoleLockReason, string> = {
  editable: 'Editable: drag this pole or enter an exact numeric translation.',
  hidden: 'Outside visible area: this pole influences a protected region.',
  trim: 'Trim protection: this pole influences a trimmed boundary.',
  manual: 'Manually locked or protected by a tangency constraint.',
  'g1-tangent-ring': 'G1: first interior ring is locked to preserve the edge tangent.',
  'g1-boundary': 'G1: the boundary is locked to preserve position and tangent.',
  'g0-boundary': 'G0: the boundary is locked to preserve position and stitching.',
}
export function poleLockDescription(reason: PoleLockReason, language: 'it' | 'en'): string {
  return language === 'en' ? poleLockExplanationEn[reason] : poleLockExplanation[reason]
}
