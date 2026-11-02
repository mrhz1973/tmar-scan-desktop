// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { useStore } from '../../src/state/store'
import { useShell } from '../../src/state/shellStore'
import { Icon } from '../../src/ui/icons'
import { useNotes } from '../reverse/state/noteStore'
const STORAGE_KEY = 'tmar.display.workspaces.v1'
export interface DisplayPrefs { labels: boolean; pins: boolean }
export function readDisplayPrefs(workspace: string): DisplayPrefs {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const own = value && typeof value === 'object' ? (value as Record<string, unknown>)[workspace] : undefined
    const item = own && typeof own === 'object' ? own as Partial<DisplayPrefs> : {}
    return { labels: typeof item.labels === 'boolean' ? item.labels : true, pins: typeof item.pins === 'boolean' ? item.pins : true }
  } catch { return { labels: true, pins: true } }
}
function remember(workspace: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    value[workspace] = { labels: useStore.getState().showLabels, pins: useNotes.getState().pinsShown }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch { /* Visibility still works when storage is unavailable. */ }
}
export function useDisplayControls(): void {
  const workspace = useShell((s) => s.workspace)
  useEffect(() => {
    if (workspace === 'flat') return
    const prefs = readDisplayPrefs(workspace)
    useStore.getState().setShowLabels(prefs.labels)
    useNotes.getState().setPinsShown(prefs.pins)
    const stopLabels = useStore.subscribe((s, old) => { if (s.showLabels !== old.showLabels) remember(workspace) })
    const stopPins = useNotes.subscribe((s, old) => { if (s.pinsShown !== old.pinsShown) remember(workspace) })
    return () => { stopLabels(); stopPins() }
  }, [workspace])
}
export function DisplayControls() {
  const workspace = useShell((s) => s.workspace)
  const labels = useStore((s) => s.showLabels), pins = useNotes((s) => s.pinsShown)
  const hasNotes = useNotes((s) => s.notes.length > 0)
  return <div className="keys" data-test="tmar-display-controls">
    <button data-test="workspace-labels" className={labels ? 'on' : undefined} aria-pressed={labels}
      title="Show or hide text labels in this workspace; notes and geometry are kept" onClick={() => useStore.getState().setShowLabels(!labels)}>
      <Icon name="labels" size={16}/>Labels
    </button>
    {/* Reverse already offers a Notes key. Other 3D workspaces need one too. */}
    {workspace !== 'reverse' && hasNotes && <button data-test="workspace-note-pins" className={pins ? 'on' : undefined} aria-pressed={pins}
      title="Show or hide note markers and their text; the notes remain saved" onClick={() => useNotes.getState().setPinsShown(!pins)}>Notes</button>}
  </div>
}
