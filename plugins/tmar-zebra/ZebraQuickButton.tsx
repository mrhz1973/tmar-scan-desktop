// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { useShell } from '../../src/state/shellStore'
import { useStore } from '../../src/state/store'
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
  if (on && ui.target === 'visible' && !re.bodies.some((b) => b.visible) && useStore.getState().fileName) ui.setTarget('scan')
  ui.setEnabled(on)
}
export function ZebraQuickButton() {
  const workspace = useShell((s) => s.workspace)
  const enabled = useZebraUi((s) => s.enabled)
  const editing = useReverse((s) => reEditorOpen(s) || s.building || !!s.playback)
  if (workspace !== 'reverse') return null
  return <div className="keys"><button data-test="zebra-quick-toggle" className={enabled ? 'on' : undefined}
    aria-pressed={enabled} disabled={editing && !enabled}
    title={editing ? 'Finish the CAD operation to use Zebra analysis' : enabled ? 'Turn Zebra off' : 'Show Zebra analysis and its stripe controls'}
    onClick={() => {
      enableZebra(!enabled)
      if (!enabled) requestAnimationFrame(() => document.querySelector('[data-test="tmar-zebra"]')?.scrollIntoView({ block: 'nearest' }))
    }}><ZebraIcon/>Zebra</button></div>
}
