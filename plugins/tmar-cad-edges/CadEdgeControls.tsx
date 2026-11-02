// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { sceneOf } from '../../src/commands/host'
import { useShell } from '../../src/state/shellStore'
import { useDeviation } from '../../src/state/deviationStore'
import { useReverse } from '../reverse/state/reStore'
import { reSceneOf } from '../reverse/viewer/reScene'
import { useCadEdges, DEFAULT_EDGES } from './edgePrefs'
import { ReferenceEdges } from './ReferenceEdges'
const panelId = 'tmar-cad-edges'
export function EdgeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 7 8-4 8 4v10l-8 4-8-4Z M4 7l8 4 8-4M12 11v10"/></svg> }
export function CadEdgeButton() {
  const workspace = useShell(s => s.workspace), enabled = useCadEdges(s => s.enabled)
  if (workspace !== 'reverse' && workspace !== 'deviation') return null
  return <div className="keys"><button data-test="cad-edges-toggle" aria-pressed={enabled} className={enabled ? 'on' : undefined}
    title="Show CAD edges: face boundaries, fillet rims and silhouettes; not triangle wireframe"
    onClick={() => useCadEdges.getState().update({ enabled: !enabled })}><EdgeIcon/>CAD edges</button>
    <button data-test="cad-edges-settings" aria-label="CAD edge color and thickness" title="CAD edge color and thickness"
      onClick={() => document.getElementById(panelId)?.scrollIntoView({block:'center'})}>⚙</button></div>
}
export function CadEdgePanel() {
  const workspace = useShell(s => s.workspace), p = useCadEdges()
  const tangent = useReverse(s => s.tangentEdges)
  const count = useReverse(s => s.bodies.length)
  const nominal = useDeviation(s => s.nominalName), busy = useDeviation(s => s.nominalBusy), split = useDeviation(s => s.split)
  if (workspace !== 'reverse' && workspace !== 'deviation') return null
  const reference = workspace === 'deviation'
  const available = reference ? !!nominal && !busy && sceneOf()?.referenceDisplay()?.cadEdges != null : count > 0
  return <section className="group" id={panelId} data-test="cad-edges-panel" aria-label="CAD edges">
    <div className="sec-head"><EdgeIcon/> CAD edges</div>
    <label className="field"><span><input type="checkbox" data-test="cad-edges-enabled" checked={p.enabled}
      onChange={e => p.update({enabled:e.target.checked})}/> Show CAD edges</span></label>
    <label className="field"><span>Edge color</span><input type="color" data-test="cad-edges-color" value={p.color} onChange={e=>p.update({color:e.target.value})}/></label>
    <label className="field"><span>Thickness · {p.width} px</span><input type="range" data-test="cad-edges-width" min="1" max="6" step="0.5" value={p.width} onChange={e=>p.update({width:Number(e.target.value)})}/></label>
    {!reference && <label className="field"><span>Tangent / fillet edges</span><select data-test="cad-edges-tangent" value={tangent} onChange={e=>useReverse.getState().setTangentEdges(e.target.value as typeof tangent)}>
      <option value="visible">Drawn</option><option value="dimmed">Dimmed</option><option value="removed">Off</option></select></label>}
    <button data-test="cad-edges-reset" onClick={()=>p.update(DEFAULT_EDGES)}>Reset edge style</button>
    <p className="hint" data-test="cad-edges-status">{reference && split ? 'Use a single Deviation viewport for CAD edges. Split-view support remains planned.' : available
      ? 'Face boundaries and silhouettes, including fillet rims. No internal triangle edges. Selection highlights remain independent.'
      : reference ? 'Load a STEP reference for CAD face boundaries. Mesh-only references do not contain CAD topology.' : 'Import a STEP body or create a CAD body. An STL shown as Scan has no CAD face topology.'}</p>
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
      const bodies = reSceneOf(scene).bodyPicks
      remove=scene.addLayer({order:120,tick:(width,height)=>{
        const p=useCadEdges.getState(), d=useDeviation.getState()
        bodies.setEdgeDisplay(workspace==='reverse'?{visible:p.enabled,color:p.color,width:p.width}:null)
        reference.tick(p,workspace==='deviation' && !d.split && !d.picking && d.source==='reference',width,height)
      },dispose:()=>{bodies.setEdgeDisplay(null);reference.dispose()}})
      scene.layerHost().invalidate()
    }
    if(workspace==='reverse'||workspace==='deviation') install()
    return()=>{canceled=true;cancelAnimationFrame(frame);remove?.()}
  },[workspace])
}
