// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sceneOf } from '../../src/commands/host'
import type { SceneManager } from '../../src/viewer/SceneManager'
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
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'


export function ZebraDeviationPanel() {
  useTmarLanguage()

  const blocked = useDeviation(s=>s.split || s.picking || s.animate || s.alignStatus === 'running')
  if (blocked) return <p className="hint" data-test="zebra-deviation-blocked">{tmarText("Zebra requires a still, single Deviation viewport. Split-view support remains planned.")}</p>
  return <ZebraPanel/>
}
export interface ZebraInspection {
  source(scene: SceneManager): THREE.Mesh | null
  label: string
  blocked: string | null
  noteBlocked: string | null
  addNote(): void
  toggle(on: boolean): void
  hint: string
}
export function ZebraPanel({ inspection }: { inspection?: ZebraInspection } = {}) {
  useTmarLanguage()

  const workspace = useShell(s=>s.workspace), onDeviation = workspace === 'deviation'
  const referenceName = useDeviation(s=>s.nominalName), showScan = useDeviation(s=>s.showScan)
  const editingNote = useNotes(s=>s.editing)
  const enabled = useZebraUi((s) => s.enabled), uiTarget = useZebraUi((s) => s.target)
  const target = inspection ? 'scan' : uiTarget
  const inspectionRef = useRef(inspection)
  inspectionRef.current = inspection
  const toggle = inspection?.toggle ?? enableZebra
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
      bodies: () => onDeviation || inspectionRef.current ? new Map() : reSceneOf(scene).bodyMeshes,
      reference: () => scene.referenceDisplay()?.mesh ?? null,
      scan: () => {
        if (inspectionRef.current) return inspectionRef.current.source(scene)
        const geometry = scene.scanGeometry()
        if (!geometry) return null
        return host.partGroup.children.find((item): item is THREE.Mesh => item instanceof THREE.Mesh && item.geometry === geometry) ?? null
      },
      invalidate: () => host.invalidate(),
      countChanged: setCount,
      deriveMissingNormals: !!inspectionRef.current,
    }, currentOptions.current)
    layer.current = zebra
    const remove = scene.addLayer(zebra)
    zebra.tick()
    return () => { layer.current = null; remove() }
  }, [enabled])

  useEffect(() => { layer.current?.setOptions(options) }, [options])

  return <section className="group" data-test="tmar-zebra" aria-label={tmarText("Zebra surface analysis")}>
    <div className="sec-head zebra-heading"><ZebraIcon/>{tmarText("Zebra surface analysis")}</div>
    <label className="field">
      <span><input data-test="zebra-enabled" type="checkbox" checked={enabled} disabled={!!inspection?.blocked && !enabled} onChange={(e) => toggle(e.target.checked)} />{tmarText(" Show zebra stripes")}</span>
    </label>
    {inspection?.blocked && <p className="hint" data-test="zebra-inspection-blocked">{tmarText(inspection.blocked)}</p>}
    {enabled && <>
      <button className={'block' + (placing ? ' on' : '')} data-test="zebra-add-note" aria-pressed={placing}
        disabled={busy || !!editingNote || !!inspection?.noteBlocked || (onDeviation ? !hasScan || !showScan : !hasScan && !hasBody)}
        title={tmarText(inspection?.noteBlocked) ?? ((onDeviation ? tmarText("Local notes in Deviation currently attach to the visible scan, not the STEP reference; save an open note first") : tmarText("Pin a note on the scan or a CAD body while Zebra is visible; save an open note first")))}
        onClick={() => {
          if (inspection) { inspection.addNote(); return }
          const notes = useNotes.getState()
          if (notes.placing) { notes.setPlacing(false); return }
          notes.showLocalNotes()
          if (notes.editing) notes.closeEditor()
          notes.setPlacing(true)
          useStore.getState().setStatus(NOTE_PLACING)
        }}>
        {placing ? tmarText("Click the part · cancel note") : tmarText("Add note on the part")}
      </button>
      <label className="field"><span>{tmarText("Analyze")}</span>
        <select data-test="zebra-target" value={target} onChange={(e) => setTarget(e.target.value as ZebraTarget)}>
          {!onDeviation && !inspection && <option value="visible">{tmarText("Visible CAD bodies")}</option>}
          {!onDeviation && !inspection && <option value="selected">{tmarText("Selected CAD bodies")}</option>}
          <option value="scan">{tmarText(inspection?.label) ?? (tmarText("Scan"))}</option>
          {onDeviation && <option value="reference" disabled={!referenceName}>{tmarText("Reference (STEP / mesh)")}</option>}
        </select>
      </label>
      <label className="field"><span>{tmarText("Stripe direction")}</span>
        <select data-test="zebra-orientation" value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
          <option value="horizontal">{tmarText("Horizontal")}</option>
          <option value="vertical">{tmarText("Vertical")}</option>
        </select>
      </label>
      <label className="field"><span>{tmarText("Stripe width · ")}{width}</span>
        <input data-test="zebra-width" type="range" min="1" max="7" step="1" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
      </label>
      <label className="field"><span>{tmarText("Stripe color")}</span>
        <input data-test="zebra-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <p className="hint" data-test="zebra-status" role="status">{unavailable ? tmarText("The 3D view is unavailable.") : count > 0 ? tmarText("Showing stripes on {0} visible {1}.", [count, count === 1 ? tmarText("object") : tmarText("objects")]) : target === 'selected' ? tmarText("Select visible CAD bodies in the body list.") : target === 'reference' ? tmarText("Load and show the reference in Surface Deviation. Hide the scan when it covers the reference.") : target === 'scan' ? tmarText("Show a scan with surface normals to analyze it.") : tmarText("Show a CAD body with surface normals to analyze it.")}</p>
      {inspection && <p className="hint" data-test="mesh-zebra-help">{tmarText(inspection.hint)}</p>}
      {inspection?.noteBlocked && <p className="hint" data-test="mesh-zebra-note-help">{tmarText(inspection.noteBlocked)}</p>}
      {onDeviation && <p className="hint">{tmarText("Zebra temporarily replaces the selected object's shading, not its geometry or measurements. Turn it off to read the comparison colors. Notes remain scan-side in this workspace.")}</p>}
      <p className="hint">{tmarText("Rotate the view to inspect reflected bands. This is a visual aid, not a numerical continuity measurement. Shading follows the displayed mesh normals.")}</p>
    </>}
  </section>
}
