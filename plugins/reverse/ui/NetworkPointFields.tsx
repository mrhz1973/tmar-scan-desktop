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
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


type Draft = Extract<FeatureDraft, { kind: 'network' }>
/** The controls change only the network draft; the host owns preview/commit. */
export function NetworkPointFields({ d, report }: { d: Draft; report?: NetworkReport }) {
  useTmarLanguage()

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
    <legend>{tmarText("Movimento 3D dei punti")}</legend>
    <label className="field"><span>{tmarText("Direzione del trascinamento")}</span>
      <select data-test="network-point-mode" value={mode} title={tmarText("La scelta della direzione non modifica la posizione. Normale usa la normale della scansione all’ancora, fissata all’inizio del gesto.")}
        onChange={e => edit(x => ({...x,pointMotion:e.target.value as NetworkPointMode}))}>
        <option value="scan">{tmarText("Sulla scansione")}</option><option value="normal">{tmarText("Normale alla scansione")}</option>
        <option value="x">{tmarText("Asse X")}</option><option value="y">{tmarText("Asse Y")}</option><option value="z">{tmarText("Asse Z")}</option>
      </select>
    </label>
    <label className="field"><span>{tmarText("Punto da modificare")}</span>
      <select data-test="network-point-target" value={ref ? pointKey(ref) : ''} title={tmarText("In modalità 3D puoi anche selezionare e trascinare il punto nella vista.")}
        onChange={e => { const p=parsePointKey(e.target.value); edit(x => ({...x,pointPicked:p??undefined})) }}>
        <option value="">{tmarText("Seleziona un punto…")}</option>
        {choices.map(c => <option key={pointKey(c.ref)} value={pointKey(c.ref)}>{tmarText(c.label)}{pointProtected(d,c.ref) ? tmarText(" · vincolato CAD") : ''}</option>)}
      </select>
    </label>
    <fieldset disabled={!ref || protectedPoint}>
      <legend>{tmarText("Spostamento dall’ancora")}</legend>
      {['X','Y','Z'].map((axis,i) => <Num key={`${ref ? pointKey(ref) : 'none'}-${axis}`} label={tmarText(axis)} value={delta[i]} testId={`network-point-offset-${i}`}
        hint={tmarText("Spostamento {0} nel riferimento del pezzo. Non riproietta il punto sulla scansione.", [axis])}
        onCommit={v => { if(ref) networkLayerIf(sceneOf())?.setPointComponent(ref,i,v) }} />)}
      <Num label={tmarText("Passo lungo la direzione")} value={distance} testId="network-point-distance" onCommit={setDistance} />
      <button data-test="network-point-move" type="button" disabled={mode==='scan'||!Number.isFinite(distance)||distance===0}
        title={tmarText("Aggiunge il passo alla posizione corrente lungo l’asse o la normale selezionata.")}
        onClick={() => { if(ref) networkLayerIf(sceneOf())?.movePointAlong(ref,distance) }}>{tmarText("Sposta punto")}</button>
      <button data-test="network-point-reset" type="button" disabled={!delta.some(v=>Math.abs(v)>0)}
        title={tmarText("Azzera soltanto lo spostamento 3D; conserva il punto e la sua ancora sulla scansione. Undo ripristina lo spostamento.")}
        onClick={() => { if(ref) edit(x=>setPointOffset(x,ref,null)) }}>{tmarText("Riporta all’ancora")}</button>
    </fieldset>
    {protectedPoint && <p role="status">{tmarText("Questo punto appartiene a un vincolo CAD. Il vincolo resta protetto.")}</p>}
    <p data-test="network-point-snap-status">{tmarText("Sulla scansione: proiezione continua, non un magnete di prossimità. In X/Y/Z e Normale il movimento è libero; magnete 3D, portata e Alt verso scan/CAD non sono ancora disponibili.")}</p>
    <p>{tmarText("Trascina il punto, non la freccia. Esc annulla il gesto; il rilascio crea un solo Undo. I punti delle curve guidano il fitting: non sono una garanzia di interpolazione esatta.")}</p>
  </fieldset>
}
