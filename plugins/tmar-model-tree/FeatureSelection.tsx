// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { CollapseButton } from '../../src/ui/CollapseButton'
import { useListSelection } from '../../src/plugins/listSelection'
import { useStore } from '../../src/state/store'
import { useCommandActivity } from '../../src/commands/activity'
import { reEditorOpen, useReverse } from '../reverse/state/reStore'
import type { Feature } from '../reverse/core/features'
import type { FeatureListEntry, FeatureListProps, FeatureRowProps } from '../reverse/app/listExtensions'
import { featureTargets, setFeatureVisibility } from './featureVisibility'
import { FEATURE_CATEGORIES, featureCategory } from './featureCategories'
import './categoryGroups.css'

function useCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  return { collapsed, toggle: () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* optional preference */ }
  } }
}

/** Each mounted category owns its selection/range anchor. Select All never
 * reaches another category, the body list, or the notes. */
function CategoryGroup({ category, items, entries }: { category: typeof FEATURE_CATEGORIES[number]; items: Feature[]; entries: ReadonlyMap<number, FeatureListEntry> }) {
  const features = useReverse((s) => s.features), bodies = useReverse((s) => s.bodies)
  const results = useReverse((s) => s.results)
  const locked = useReverse((s) => s.building || reEditorOpen(s) || s.playback !== null)
  const busy = useStore((s) => s.busy), commandRunning = useCommandActivity((s) => s.running !== null)
  const part = useStore((s) => s.fileName)
  const selection = useListSelection(items.map((f) => f.id), part)
  const { collapsed, toggle } = useCollapsed(`tmar.modelTree.category.${category.id}.collapsed`)
  const targets = featureTargets({ features, bodies, results }, selection.ids, category.id)
  const hasOutput = targets.sketches.length + targets.bodies.length > 0
  const disabled = locked || busy || commandRunning || !hasOutput
  const builtIds = new Set(features.map((f) => f.id)), selected = new Set(selection.ids)
  const contentId = `tmar-category-${category.id}`
  return <section className="tmar-feature-category" data-test="feature-category" data-feature-category={category.id}
    aria-label={category.label} onKeyDown={(event) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); selection.all()
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); selection.clear() }
    }}>
    <CollapseButton label={category.label} collapsed={collapsed} count={items.length}
      controls={contentId} testId={`category-collapse-${category.id}`} onToggle={toggle}/>
    <div id={contentId} hidden={collapsed}>
      <div className="toolrow tmar-feature-tools">
        <button data-test="features-select-all" onClick={selection.all} disabled={!items.length} title={`Select all ${category.label.toLowerCase()} only`}>Select all</button>
        <button data-test="features-clear" onClick={selection.clear} disabled={!selected.size}>Clear</button>
        <span data-test="features-selected-count">{selected.size} selected</span>
        {category.id !== 'other' && <>
          <button data-test="features-show" disabled={disabled} onClick={() => setFeatureVisibility(selection.ids, true, category.id)}>Show selected</button>
          <button data-test="features-hide" disabled={disabled} onClick={() => setFeatureVisibility(selection.ids, false, category.id)}>Hide selected</button>
        </>}
      </div>
      <p className="hint">{category.hint}</p>
      <p className="hint tmar-category-scope" data-test="category-scope" role="status">
        {selected.size ? `${targets.sketches.length} sketch outputs, ${targets.bodies.length} body outputs in this category. ${targets.skipped.length} without an independent compatible output.` : 'Ctrl/Cmd adds rows; Shift selects a range within this category.'}
      </p>
      <div role="listbox" aria-label={category.label} aria-multiselectable="true" tabIndex={0}>
        {items.map((feature) => {
          const rolled = !builtIds.has(feature.id), result = results[feature.id]
          return <div key={feature.id} data-test="feature-select-row" data-feature-id={feature.id}
            role="option" aria-selected={selected.has(feature.id)} tabIndex={0}
            className={selected.has(feature.id) ? 'tmar-feature-selected' : undefined}
            onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,select,a')) selection.select(feature.id, event) }}
            onDoubleClickCapture={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) event.stopPropagation() }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); selection.select(feature.id, { ctrlKey: true }) }
            }}>
            {entries.get(feature.id)?.content}
            {!rolled && !feature.suppressed && result?.status === 'failed' && <p className="hint warn">{result.message}</p>}
            {!rolled && !feature.suppressed && result?.status === 'ok' && result.note && <p className="hint">{result.note}</p>}
            {!rolled && !feature.suppressed && result?.status === 'ok' && result.warning && <p className="hint warn">{result.warning}</p>}
          </div>
        })}
      </div>
    </div>
  </section>
}

export function FeatureSelection({ children, entries }: FeatureListProps) {
  const features = useReverse((s) => s.features), rolled = useReverse((s) => s.rolledBack)
  const playing = useReverse((s) => s.playback !== null)
  const { collapsed, toggle } = useCollapsed('tmar.modelTree.featuresCollapsed')
  const all = [...features, ...rolled]
  const [historyOpen, setHistoryOpen] = useState(false)
  const rows = new Map(entries.map((entry) => [entry.id, entry]))
  // An upstream layout that stops tagging rows must not silently lose work.
  const complete = rows.size === entries.length && rows.size === all.length && all.every((feature) => rows.has(feature.id))
  return <section data-test="feature-selection" aria-label="Features by category">
    <CollapseButton label="Features by category" collapsed={collapsed && !playing} count={all.length}
      controls="tmar-features-content" testId="features-collapse" onToggle={toggle}/>
    <div id="tmar-features-content" hidden={collapsed && !playing}>
      <p className="hint">Each group has its own selection and visibility. The separate Bodies list controls actual model bodies. No command here selects every category together.</p>
      {!complete && <p className="hint warn" role="status">This layout cannot group every feature safely. Use the original history below; no visibility action was applied.</p>}
      {complete && FEATURE_CATEGORIES.map((category) => {
        const items = all.filter((feature) => featureCategory(feature) === category.id)
        return items.length ? <CategoryGroup key={category.id} category={category} items={items} entries={rows}/> : null
      })}
      {/* Keep the inherited chronology mounted and in its original order.
          Rollback/playback never operate on the category display order. */}
      <details data-test="feature-build-history" className="tmar-build-history" open={historyOpen || playing || !complete}
        onToggle={(event) => { if (!playing) setHistoryOpen(event.currentTarget.open) }}>
        <summary>Build history / rollback</summary>
        <p className="hint">Original chronological controls for rollback, playback, suppression and deletion. Visibility groups above never suppress or rebuild features.</p>
        {children}
      </details>
    </div>
  </section>
}

/** The original history retains its own editing/playback selection. */
export function FeatureSelectionRow({ children }: FeatureRowProps) { return <>{children}</> }
