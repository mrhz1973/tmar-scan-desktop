// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { useShell } from '../../src/state/shellStore'
import { useStore } from '../../src/state/store'
import { useDeviation } from '../../src/state/deviationStore'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import type { ZebraTarget } from './ZebraLayer'

export const useZebraUi = create<{ enabled: boolean; target: ZebraTarget; setEnabled: (on: boolean) => void; setTarget: (target: ZebraTarget) => void }>((set) => ({
  enabled: false, target: 'visible', setEnabled: (enabled) => set({ enabled }), setTarget: (target) => set({ target }),
}))
export function ZebraIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M4 3c9 4-5 14 4 18M10 3c9 4-5 14 4 18M16 3c9 4-5 14 4 18"/></svg>
}
export function enableZebra(on: boolean): void {
  const ui = useZebraUi.getState(), re = useReverse.getState()
  if (on && useShell.getState().workspace === 'deviation') {
    const d=useDeviation.getState()
    if (d.split || d.picking || d.animate || d.alignStatus === 'running') return
    ui.setTarget(d.source === 'reference' && d.nominalName && d.showNominal ? 'reference' : 'scan')
  }
  if (on && useShell.getState().workspace === 'reverse' && ui.target === 'visible' && !re.bodies.some((b) => b.visible) && useStore.getState().fileName) ui.setTarget('scan')
  ui.setEnabled(on)
}
export function ZebraQuickButton() {
  const workspace = useShell((s) => s.workspace)
  const enabled = useZebraUi((s) => s.enabled)
  const cadEditing = useReverse((s) => reEditorOpen(s) || s.building || !!s.playback)
  const devBlocked = useDeviation(s => s.split || s.picking || s.animate || s.alignStatus === 'running')
  const editing = workspace === 'reverse' ? cadEditing : devBlocked
  if (workspace !== 'reverse' && workspace !== 'deviation') return null
  return <div className="keys"><button data-test="zebra-quick-toggle" className={enabled ? 'on' : undefined}
    aria-pressed={enabled} disabled={editing && !enabled}
    title={editing ? 'Finish the active operation and use a single viewport for Zebra analysis' : enabled ? 'Turn Zebra off' : 'Show Zebra analysis and its stripe controls'}
    onClick={() => {
      enableZebra(!enabled)
      if (!enabled) requestAnimationFrame(() => document.querySelector('[data-test="tmar-zebra"]')?.scrollIntoView({ block: 'nearest' }))
    }}><ZebraIcon/>Zebra</button></div>
}
