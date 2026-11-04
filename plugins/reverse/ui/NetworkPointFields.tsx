// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { sceneOf } from '../../../src/commands/host'
import { useStore } from '../../../src/state/store'
import type { NetworkReport } from '../core/networkBody'
import { offsetDelta, parsePointKey, pointKey, pointOffset, pointProtected, type NetworkPointRef, type NetworkPointMode } from '../core/networkPointMotion'
import { setPointOffset } from '../state/reNetworkDraft'
import { useReverse, type FeatureDraft } from '../state/reStore'
import { networkLayerIf } from '../viewer/networkLayer'
import { Num } from './featureFields'

type Draft = Extract<FeatureDraft, { kind: 'network' }>
/** The controls change only the network draft; the host owns preview/commit. */
export function NetworkPointFields({ d, report }: { d: Draft; report?: NetworkReport }) {
  const [distance, setDistance] = useState(.1)
  const choices: { ref: NetworkPointRef; label: string }[] = [
    ...d.nodes.map(n => ({ref:{kind:'node' as const,id:n.id},label:`Nodo ${n.id}`})),
    ...d.curves.flatMap(c => c.via.map((_,index) => ({ref:{kind:'grip' as const,curve:c.id,index},label:`Curva ${c.id} · punto ${index+1}`}))),
    ...(report?.centres ?? []).map(c => ({ref:{kind:'centre' as const,cell:c.cell},label:`Centro interno ${c.cell+1}`})),
  ]
  const chosen = d.pointPicked && choices.find(c => pointKey(c.ref) === pointKey(d.pointPicked!))
  const ref = chosen?.ref ?? null, mode = d.pointMotion ?? 'scan'
  const protectedPoint = ref ? pointProtected(d,ref) : false
  const delta = ref ? offsetDelta(pointOffset(d,ref)) : [0,0,0]
  const edit = (fn: (x: Draft) => Draft) => {
    try { useReverse.getState().editNetwork(fn) }
    catch(error) { useStore.getState().setError(error instanceof Error ? error.message : String(error)) }
  }
  if (!choices.length) return null
  return <fieldset data-test="network-point-motion" disabled={!!d.motionActive || !!d.placing}>
    <legend>Movimento 3D dei punti</legend>
    <label className="field"><span>Direzione del trascinamento</span>
      <select data-test="network-point-mode" value={mode} title="La scelta della direzione non modifica la posizione. Normale usa la normale della scansione all’ancora, fissata all’inizio del gesto."
        onChange={e => edit(x => ({...x,pointMotion:e.target.value as NetworkPointMode}))}>
        <option value="scan">Sulla scansione</option><option value="normal">Normale alla scansione</option>
        <option value="x">Asse X</option><option value="y">Asse Y</option><option value="z">Asse Z</option>
      </select>
    </label>
    <label className="field"><span>Punto da modificare</span>
      <select data-test="network-point-target" value={ref ? pointKey(ref) : ''} title="In modalità 3D puoi anche selezionare e trascinare il punto nella vista."
        onChange={e => { const p=parsePointKey(e.target.value); edit(x => ({...x,pointPicked:p??undefined})) }}>
        <option value="">Seleziona un punto…</option>
        {choices.map(c => <option key={pointKey(c.ref)} value={pointKey(c.ref)}>{c.label}{pointProtected(d,c.ref) ? ' · vincolato CAD' : ''}</option>)}
      </select>
    </label>
    <fieldset disabled={!ref || protectedPoint}>
      <legend>Spostamento dall’ancora</legend>
      {['X','Y','Z'].map((axis,i) => <Num key={`${ref ? pointKey(ref) : 'none'}-${axis}`} label={axis} value={delta[i]} testId={`network-point-offset-${i}`}
        hint={`Spostamento ${axis} nel riferimento del pezzo. Non riproietta il punto sulla scansione.`}
        onCommit={v => { if(ref) networkLayerIf(sceneOf())?.setPointComponent(ref,i,v) }} />)}
      <Num label="Passo lungo la direzione" value={distance} testId="network-point-distance" onCommit={setDistance} />
      <button data-test="network-point-move" type="button" disabled={mode==='scan'||!Number.isFinite(distance)||distance===0}
        title="Aggiunge il passo alla posizione corrente lungo l’asse o la normale selezionata."
        onClick={() => { if(ref) networkLayerIf(sceneOf())?.movePointAlong(ref,distance) }}>Sposta punto</button>
      <button data-test="network-point-reset" type="button" disabled={!delta.some(v=>Math.abs(v)>0)}
        title="Azzera soltanto lo spostamento 3D; conserva il punto e la sua ancora sulla scansione. Undo ripristina lo spostamento."
        onClick={() => { if(ref) edit(x=>setPointOffset(x,ref,null)) }}>Riporta all’ancora</button>
    </fieldset>
    {protectedPoint && <p role="status">Questo punto appartiene a un vincolo CAD. Il vincolo resta protetto.</p>}
    <p data-test="network-point-snap-status">Sulla scansione: proiezione continua, non un magnete di prossimità. In X/Y/Z e Normale il movimento è libero; magnete 3D, portata e Alt verso scan/CAD non sono ancora disponibili.</p>
    <p>Trascina il punto, non la freccia. Esc annulla il gesto; il rilascio crea un solo Undo. I punti delle curve guidano il fitting: non sono una garanzia di interpolazione esatta.</p>
  </fieldset>
}
