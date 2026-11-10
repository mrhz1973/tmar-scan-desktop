// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { sceneOf } from '../../src/commands/host'
import { useStore } from '../../src/state/store'
import { useShell } from '../../src/state/shellStore'
import { useDeviation } from '../../src/state/deviationStore'
import { useReverse } from '../reverse/state/reStore'
import { reSceneOf } from '../reverse/viewer/reScene'
import { useCadEdges, DEFAULT_EDGES } from './edgePrefs'
import { ReferenceEdges } from './ReferenceEdges'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'

const panelId = 'tmar-cad-edges'
export function EdgeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 7 8-4 8 4v10l-8 4-8-4Z M4 7l8 4 8-4M12 11v10"/></svg> }
export function CadEdgeButton() {
  useTmarLanguage()

  const workspace = useShell(s => s.workspace), enabled = useCadEdges(s => s.enabled)
  if (workspace !== 'reverse' && workspace !== 'deviation' && workspace !== 'mesh') return null
  return <div className="keys"><button data-test="cad-edges-toggle" aria-pressed={enabled} className={enabled ? 'on' : undefined}
    title={tmarText("Show CAD edges: face boundaries, fillet rims and silhouettes; not triangle wireframe")}
    onClick={() => useCadEdges.getState().update({ enabled: !enabled })}><EdgeIcon/>{tmarText("CAD edges")}</button>
    <button data-test="cad-edges-settings" aria-label={tmarText("CAD edge color and thickness")} title={tmarText("CAD edge color and thickness")}
      onClick={() => document.getElementById(panelId)?.scrollIntoView({block:'center'})}>⚙</button></div>
}
export function CadEdgePanel() {
  useTmarLanguage()

  const workspace = useShell(s => s.workspace), p = useCadEdges()
  const tangent = useReverse(s => s.tangentEdges)
  const count = useReverse(s => s.bodies.length)
  const fileName = useStore(s => s.fileName), scanBusy = useStore(s => s.busy)
  useStore(s => s.triangleCount)
  const scanTopology = !!fileName && !scanBusy && sceneOf()?.scanDisplay()?.cadEdges != null
  const nominal = useDeviation(s => s.nominalName), busy = useDeviation(s => s.nominalBusy), split = useDeviation(s => s.split)
  if (workspace !== 'reverse' && workspace !== 'deviation' && workspace !== 'mesh') return null
  const reference = workspace === 'deviation'
  const available = reference ? !!nominal && !busy && sceneOf()?.referenceDisplay()?.cadEdges != null : (workspace === 'reverse' && count > 0) || scanTopology
  return <section className="group" id={panelId} data-test="cad-edges-panel" aria-label={tmarText("CAD edges")}>
    <div className="sec-head"><EdgeIcon/>{tmarText(" CAD edges")}</div>
    <label className="field"><span><input type="checkbox" data-test="cad-edges-enabled" checked={p.enabled}
      onChange={e => p.update({enabled:e.target.checked})}/>{tmarText(" Show CAD edges")}</span></label>
    <label className="field"><span>{tmarText("Edge color")}</span><input type="color" data-test="cad-edges-color" value={p.color} onChange={e=>p.update({color:e.target.value})}/></label>
    <label className="field"><span>{tmarText("Thickness · ")}{p.width}{tmarText(" px")}</span><input type="range" data-test="cad-edges-width" min="1" max="6" step="0.5" value={p.width} onChange={e=>p.update({width:Number(e.target.value)})}/></label>
    {workspace === 'reverse' && count > 0 && <label className="field"><span>{tmarText("Tangent / fillet edges")}</span><select data-test="cad-edges-tangent" value={tangent} onChange={e=>useReverse.getState().setTangentEdges(e.target.value as typeof tangent)}>
      <option value="visible">{tmarText("Drawn")}</option><option value="dimmed">{tmarText("Dimmed")}</option><option value="removed">{tmarText("Off")}</option></select></label>}
    <button data-test="cad-edges-reset" onClick={()=>p.update(DEFAULT_EDGES)}>{tmarText("Reset edge style")}</button>
    <p className="hint" data-test="cad-edges-status">{reference && split ? tmarText("Use a single Deviation viewport for CAD edges. Split-view support remains planned.") : available ? !reference && scanTopology ? tmarText("STEP loaded as Scan: original CAD face boundaries and silhouettes are available. No internal triangle edges.") : tmarText("Face boundaries and silhouettes, including fillet rims. No internal triangle edges. Selection highlights remain independent.") : reference ? tmarText("Load a STEP reference for CAD face boundaries. Mesh-only references do not contain CAD topology.") : tmarText("Load STEP as Scan, import a STEP body or create a CAD body. STL/PLY/OBJ scans do not contain original CAD face topology.")}</p>
  </section>
}
export function useCadEdgeDisplay(): void {
  const workspace = useShell(s=>s.workspace), prefs = useCadEdges()
  useEffect(() => { sceneOf()?.layerHost().invalidate() }, [prefs.enabled,prefs.color,prefs.width])
  useEffect(() => {
    let canceled=false, frame=0, remove:(()=>void)|undefined
    const install=() => {
      if(canceled) return
      const scene=sceneOf()
      if(!scene){frame=requestAnimationFrame(install);return}
      const reference = new ReferenceEdges(scene)
      const scan = new ReferenceEdges(scene, () => scene.scanDisplay(), 'scan')
      const bodies = reSceneOf(scene).bodyPicks
      remove=scene.addLayer({order:120,tick:(width,height)=>{
        const p=useCadEdges.getState(), d=useDeviation.getState()
        bodies.setEdgeDisplay(workspace==='reverse'?{visible:p.enabled,color:p.color,width:p.width}:null)
        reference.tick(p,workspace==='deviation' && !d.split && !d.picking && d.source==='reference',width,height)
        scan.tick(p,workspace==='reverse' || workspace==='mesh' || (workspace==='deviation' && !d.split && !d.picking && !d.animate),width,height)
      },dispose:()=>{bodies.setEdgeDisplay(null);reference.dispose();scan.dispose()}})
      scene.layerHost().invalidate()
    }
    if(workspace==='reverse'||workspace==='deviation'||workspace==='mesh') install()
    return()=>{canceled=true;cancelAnimationFrame(frame);remove?.()}
  },[workspace])
}
