// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sceneOf } from '../../src/commands/host'
import { useStore } from '../../src/state/store'
import { useShell } from '../../src/state/shellStore'
import { useDeviation } from '../../src/state/deviationStore'
import { NOTE_PLACING } from '../reverse/app/useNotePins'
import { bodiesOfPick } from '../reverse/core/bodyFolders'
import { useNotes } from '../reverse/state/noteStore'
import { useReverse } from '../reverse/state/reStore'
import { reSceneOf } from '../reverse/viewer/reScene'
import { ZebraLayer, type ZebraOptions, type ZebraTarget } from './ZebraLayer'
import type { Orientation } from './pattern'
import { enableZebra, useZebraUi, ZebraIcon } from './ZebraQuickButton'
import './zebraControls.css'

export function ZebraDeviationPanel() {
  const blocked = useDeviation(s=>s.split || s.picking || s.animate || s.alignStatus === 'running')
  if (blocked) return <p className="hint" data-test="zebra-deviation-blocked">Zebra requires a still, single Deviation viewport. Split-view support remains planned.</p>
  return <ZebraPanel/>
}
export function ZebraPanel() {
  const workspace = useShell(s=>s.workspace), onDeviation = workspace === 'deviation'
  const referenceName = useDeviation(s=>s.nominalName), showScan = useDeviation(s=>s.showScan)
  const editingNote = useNotes(s=>s.editing)
  const enabled = useZebraUi((s) => s.enabled), target = useZebraUi((s) => s.target)
  const setTarget = useZebraUi((s) => s.setTarget)
  useEffect(() => () => useZebraUi.setState({ enabled: false, target: 'visible' }), [])
  const [orientation, setOrientation] = useState<Orientation>('horizontal')
  const [width, setWidth] = useState(3)
  const [color, setColor] = useState('#5388b1')
  const [count, setCount] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  const layer = useRef<ZebraLayer | null>(null)
  const pick = useReverse((s) => s.listSelection)
  const folders = useReverse((s) => s.bodyFolders)
  const hasBody = useReverse((s) => s.bodies.length > 0)
  const hasScan = useStore((s) => s.fileName !== null)
  const busy = useStore((s) => s.busy)
  const placing = useNotes((s) => s.placing)
  const selectedIds = useMemo(() => [...bodiesOfPick(folders, pick)], [folders, pick])
  const options = useMemo<ZebraOptions>(() => ({ target, selectedIds, orientation, width, color }), [target, selectedIds, orientation, width, color])
  const currentOptions = useRef(options)
  currentOptions.current = options

  useEffect(() => {
    if (!enabled) return
    const scene = sceneOf()
    if (!scene) { setUnavailable(true); return }
    setUnavailable(false)
    const host = scene.layerHost()
    const zebra = new ZebraLayer({
      bodies: () => onDeviation ? new Map() : reSceneOf(scene).bodyMeshes,
      reference: () => scene.referenceDisplay()?.mesh ?? null,
      scan: () => {
        const geometry = scene.scanGeometry()
        if (!geometry) return null
        return host.partGroup.children.find((item): item is THREE.Mesh => item instanceof THREE.Mesh && item.geometry === geometry) ?? null
      },
      invalidate: () => host.invalidate(),
      countChanged: setCount,
    }, currentOptions.current)
    layer.current = zebra
    const remove = scene.addLayer(zebra)
    zebra.tick()
    return () => { layer.current = null; remove() }
  }, [enabled])

  useEffect(() => { layer.current?.setOptions(options) }, [options])

  return <section className="group" data-test="tmar-zebra" aria-label="Zebra surface analysis">
    <div className="sec-head zebra-heading"><ZebraIcon/>Zebra surface analysis</div>
    <label className="field">
      <span><input data-test="zebra-enabled" type="checkbox" checked={enabled} onChange={(e) => enableZebra(e.target.checked)} /> Show zebra stripes</span>
    </label>
    {enabled && <>
      <button className={'block' + (placing ? ' on' : '')} data-test="zebra-add-note" aria-pressed={placing}
        disabled={busy || !!editingNote || (onDeviation ? !hasScan || !showScan : !hasScan && !hasBody)}
        title={onDeviation ? 'Local notes in Deviation currently attach to the visible scan, not the STEP reference; save an open note first' : 'Pin a note on the scan or a CAD body while Zebra is visible; save an open note first'}
        onClick={() => {
          const notes = useNotes.getState()
          if (notes.placing) { notes.setPlacing(false); return }
          notes.showLocalNotes()
          if (notes.editing) notes.closeEditor()
          notes.setPlacing(true)
          useStore.getState().setStatus(NOTE_PLACING)
        }}>
        {placing ? 'Click the part · cancel note' : 'Add note on the part'}
      </button>
      <label className="field"><span>Analyze</span>
        <select data-test="zebra-target" value={target} onChange={(e) => setTarget(e.target.value as ZebraTarget)}>
          {!onDeviation && <option value="visible">Visible CAD bodies</option>}
          {!onDeviation && <option value="selected">Selected CAD bodies</option>}
          <option value="scan">Scan</option>
          {onDeviation && <option value="reference" disabled={!referenceName}>Reference (STEP / mesh)</option>}
        </select>
      </label>
      <label className="field"><span>Stripe direction</span>
        <select data-test="zebra-orientation" value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      </label>
      <label className="field"><span>Stripe width · {width}</span>
        <input data-test="zebra-width" type="range" min="1" max="7" step="1" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </label>
      <label className="field"><span>Stripe color</span>
        <input data-test="zebra-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <p className="hint" data-test="zebra-status" role="status">{unavailable
        ? 'The 3D view is unavailable.'
        : count > 0 ? `Showing stripes on ${count} visible ${count === 1 ? 'object' : 'objects'}.`
          : target === 'selected' ? 'Select visible CAD bodies in the body list.'
            : target === 'reference' ? 'Load and show the reference in Surface Deviation. Hide the scan when it covers the reference.'
            : target === 'scan' ? 'Show a scan with surface normals to analyze it.'
              : 'Show a CAD body with surface normals to analyze it.'}</p>
      {onDeviation && <p className="hint">Zebra temporarily replaces the selected object's shading, not its geometry or measurements. Turn it off to read the comparison colors. Notes remain scan-side in this workspace.</p>}
      <p className="hint">Rotate the view to inspect reflected bands. This is a visual aid, not a numerical continuity measurement. Shading follows the displayed mesh normals.</p>
    </>}
  </section>
}
