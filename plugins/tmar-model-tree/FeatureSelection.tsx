// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, useState, type PropsWithChildren } from 'react'
import { useListSelection } from '../../src/plugins/listSelection'
import { useStore } from '../../src/state/store'
import { useCommandActivity } from '../../src/commands/activity'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import type { FeatureRowProps } from '../reverse/app/listExtensions'
import { setFeatureVisibility } from './featureVisibility'
const SelectionContext = createContext<ReturnType<typeof useListSelection> | null>(null)
const COLLAPSE_KEY = 'tmar.modelTree.featuresCollapsed'
const storedCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
export function FeatureSelection({ children }: PropsWithChildren) {
  const features = useReverse((s) => s.features), rolled = useReverse((s) => s.rolledBack)
  const locked = useReverse((s) => s.building || reEditorOpen(s) || s.playback !== null)
  const busy = useStore((s) => s.busy), commandRunning = useCommandActivity((s) => s.running !== null)
  const part = useStore((s) => s.fileName)
  const selection = useListSelection([...features, ...rolled].map((f) => f.id), part)
  const [collapsed, setCollapsed] = useState(storedCollapsed)
  const disabled = locked || busy || commandRunning || !selection.ids.length
  return <SelectionContext.Provider value={selection}><section data-test="feature-selection" aria-label="Feature multi-selection" tabIndex={0}
    onKeyDown={(e) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); selection.all() }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); selection.clear() }
    }}>
    <div className="g-label"><button data-test="features-collapse" aria-expanded={!collapsed} onClick={() => {
      setCollapsed(!collapsed); try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '0' : '1') } catch { /* optional */ }
    }}>{collapsed ? '▸' : '▾'} Features ({features.length + rolled.length})</button></div>
    <div hidden={collapsed}>
      <div className="toolrow tmar-feature-tools">
        <button data-test="features-select-all" onClick={selection.all}>Select all</button>
        <button data-test="features-clear" onClick={selection.clear} disabled={!selection.ids.length}>Clear</button>
        <span data-test="features-selected-count">{selection.ids.length} selected</span>
        <button data-test="features-show" disabled={disabled} onClick={() => setFeatureVisibility(selection.ids, true)}>Show</button>
        <button data-test="features-hide" disabled={disabled} onClick={() => setFeatureVisibility(selection.ids, false)}>Hide</button>
      </div>
      <p className="hint">Ctrl/Cmd adds rows; Shift selects a range. Show/Hide affects sketches and current body outputs, never feature suppression.</p>
      <div role="listbox" aria-label="Features" aria-multiselectable="true">{children}</div>
    </div>
  </section></SelectionContext.Provider>
}
export function FeatureSelectionRow({ id, children }: FeatureRowProps) {
  const selection = useContext(SelectionContext)
  if (!selection) return <>{children}</>
  const selected = selection.ids.includes(id)
  return <div data-test="feature-select-row" data-feature-id={id} role="option" aria-selected={selected} tabIndex={0}
    className={selected ? 'tmar-feature-selected' : undefined}
    onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,select,a')) selection.select(id, event) }}
    onDoubleClickCapture={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) event.stopPropagation() }}
    onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === ' ') { event.preventDefault(); event.stopPropagation(); selection.select(id, { ctrlKey: true }) } }}>
    {children}
  </div>
}
