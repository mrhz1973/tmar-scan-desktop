// SPDX-License-Identifier: AGPL-3.0-only
// The Patch network's box: how to place patches and change them, the tool
// a click on the scan is, the patch being placed, Fill all, Suggest
// creases (PN12), the editor's own undo, the status line, a row per patch
// — RMS, worst point, net — with the picked patch's strips to set and its
// Delete, the regions refused and why, and the fit's settings (PN10).
// What it shows of the report is the last one built, kept while the next
// is (useNetworkReport).

import { useState } from 'react'
import { useLength } from '../../../src/app/useUnits'
import { sceneOf } from '../../../src/commands/host'
import { fmtLen, type DisplayUnits } from '../../../src/core/units'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberInput } from '../../../src/ui/NumberField'
import type { NetworkReport } from '../core/networkBody'
import { DEFAULT_TOLERANCE, SPANS_MAX, SPANS_MIN } from '../core/networkCurve'
import { acceptCreases, addSeeds, redoNetwork, removeReportedPatch, removeSeed, setNetworkFit, setSide, setStripSpans, setSuggested, undoNetwork } from '../state/reNetworkDraft'
import { networkLayerIf } from '../viewer/networkLayer'
import type { FaceInfo } from '../core/build'
import type { EdgeRef } from '../core/features'
import { describeFaceIn, matchEdge, matchTolerance } from '../core/topo'
import { reverseSession } from '../app/reSession'
import { useNetworkReport, useNetworkReportCurrent } from '../app/useNetworkLayer'
import { type FeatureDraft, useReverse } from '../state/reStore'
import { Num } from './featureFields'
import { NetworkPointFields } from './NetworkPointFields'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


type NetworkDraftOpen = Extract<FeatureDraft, { kind: 'network' }>

/** The status line: patches, regions closed but not filled, the worst
 *  angle across a tangent curve and the worst gap — or what there is yet.
 *  The gap is in micrometres, or in inches when they are shown; the
 *  command that reads this line gives no units and has micrometres. */
export function networkStatus(report: NetworkReport | undefined, d: NetworkDraftOpen, units: DisplayUnits = 'mm'): string {
  // Nothing yet: the hint under the box says how to start, and the patch
  // being placed says the rest.
  if (!report) return d.curves.length === 0 ? (d.placing ? '' : 'No patches yet.') : `${d.curves.length} curve${d.curves.length === 1 ? '' : 's'} · building…`
  const n = report.patches.length
  const open = report.unfilled.length
  const refused = report.cells.filter((c) => 'refused' in c).length
  const parts = [`${n} patch${n === 1 ? '' : 'es'}`]
  if (open > 0) parts.push(`${open} open cell${open === 1 ? '' : 's'}`)
  if (refused > 0) parts.push(`${refused} refused`)
  if (n > 0) {
    parts.push(`worst edge ${report.worstAngle.toFixed(report.worstAngle < 1 ? 2 : 1)}°`)
    parts.push(`worst gap ${units === 'in' ? fmtLen(report.worstGap, units, 4) : `${(report.worstGap * 1000).toFixed(report.worstGap < 0.01 ? 1 : 0)} µm`}`)
    // A corner of three, five or six patches is held near tangent, not
    // tangent: its worst angle stands beside the edges'.
    if (report.corners.length > 0) parts.push(`worst corner ${Math.max(...report.corners.map((c) => c.angle)).toFixed(1)}°`)
    if (report.closed) parts.push('closed — a solid')
  }
  return parts.join(' · ')
}

/** The strip a curve is in, by the report. */
function stripOf(report: NetworkReport | undefined, curve: number | undefined) {
  if (!report || curve === undefined) return null
  return report.strips.find((s) => s.curves.includes(curve)) ?? null
}

export function NetworkFields({ d }: { d: NetworkDraftOpen }) {
  useTmarLanguage()

  const report = useNetworkReport() ?? undefined
  // The last report's patch numbers, while a later change builds, are not
  // this draft's: what acts on them waits for the build.
  const current = useNetworkReportCurrent()
  const len = useLength()
  const edit = (change: (x: NetworkDraftOpen) => NetworkDraftOpen) => useReverse.getState().editNetwork(change)
  const picked = d.picked !== null && report ? report.patches[d.picked] : undefined
  const refused = (report?.cells ?? []).map((c, i) => ({ c, i })).filter(({ c }) => 'refused' in c)
  const [finding, setFinding] = useState(false)
  const suggest = () => {
    setFinding(true)
    // A moment for the button to say so: the search holds the page while
    // it runs.
    setTimeout(() => {
      try {
        networkLayerIf(sceneOf())?.suggest()
      } finally {
        setFinding(false)
      }
    }, 30)
  }
  const stripField = (label: string, curve: number | undefined, testId: string) => {
    const strip = stripOf(report, curve)
    if (!strip) return null
    return (
      <div className="field" key={testId}>
        <span>{tmarText(label)}</span>
        <span className="unitfield">
          <label className="checkrow" title={tmarText("The strip's span count chosen by the fit: 4, and more only where a patch on it misses the scan by more than the tolerance beyond its noise, while that helps — up to 20")}>
            <input type="checkbox" data-test={`${testId}-auto`} checked={strip.auto} onChange={(e) => edit((x) => setStripSpans(x, strip.curves, e.target.checked ? null : strip.spans))} />
            <span>{tmarText("Auto")}</span>
          </label>
          <NumberInput
            data-test={testId}
            min={SPANS_MIN}
            max={SPANS_MAX}
            value={strip.spans}
            disabled={strip.auto}
            onCommit={(typed) => {
              if (typed === null) return
              const v = Math.max(SPANS_MIN, Math.min(SPANS_MAX, Math.round(typed)))
              if (v !== strip.spans) edit((x) => setStripSpans(x, strip.curves, v))
            }}
            style={{ width: 52 }}
          />
          <span>{tmarText("spans")}</span>
        </span>
      </div>
    )
  }
  return (
    <>
      <div className="field">
        <span>{tmarText("Click to")}<InfoDot title={tmarText("Placing patches")}>
            <p>
              <b>{tmarText("Draw")}</b>{tmarText(": click the corners of a patch one after the other — on the scan, or on a corner, an edge or a point already there, to join the patches. The sides follow the scan between them, and the patch shows shaded as you go. Click the first corner again, press Enter, double-click or click the middle button to close it: it is fitted at once. Four corners make a patch as it is; three, five or six are split from a centre into four-sided ones (drag its square; Delete puts it back in the middle). Backspace takes the last corner back, Esc lets the patch go; Enter with two corners makes a line. Drag an outer edge of a patch across the scan to make the next patch beside it; its new corners snap to corners near them.")}</p>
            <p>
              <b>{tmarText("Changing a patch")}</b>{tmarText(": drag a corner or a point to move it; drag an edge two patches share to bend it, a point put in where you pressed. Shift-click an edge puts a point in — on an outer edge, whose drag makes the next patch, drag that point. Click a patch to pick it: its spans come up below, and Delete (or Delete patch) takes it out with the edges no other patch has. Delete takes the point, corner or edge under the cursor out; C makes the edge under it a crease — a fold or a parting line the patches meet at an angle on; the wheel over an edge sets its strip's spans. Click a body's edge to run an edge along it.")}</p>
            <p>
              <b>{tmarText("Fill")}</b>{tmarText(": click inside a region the edges close to fill it, or on a patch to pick it; Ctrl-click a patch to empty it. Fill all fills every closed region. The curvature colouring on the scan shows where the creases and the bends are.")}</p>
            <p>
              <b>{tmarText("Suggest creases")}</b>{tmarText(" finds the scan's sharp edges and folds — not its rounds — and draws them dashed: click one to take it as a crease curve, or Accept all. Two taken that meet share a node there.")}</p>
          </InfoDot>
        </span>
        <span className="toolrow" data-test="network-tool">
          {(['draw', 'fill'] as const).map((t) => (
            <button key={t} data-test={`network-tool-${t}`} className={d.tool === t ? 'on' : ''} onClick={() => edit((x) => ({ ...x, tool: t, placing: t === 'fill' ? null : x.placing }))}>
              {t === 'draw' ? tmarText("Draw") : tmarText("Fill")}
            </button>
          ))}
        </span>
      </div>
      <div className="toolrow">
        <button data-test="network-fill-all" disabled={!report || report.unfilled.length === 0} title={tmarText("Fill every region the curves close with a patch")} onClick={() => report && edit((x) => addSeeds(x, report.unfilled.map((u) => u.seed)))}>{tmarText("Fill all")}{report && report.unfilled.length > 0 ? tmarText(" ({0})", [report.unfilled.length]) : ''}
        </button>
        <button data-test="network-suggest" disabled={finding} title={tmarText("Find the scan's sharp edges and folds, to take as crease curves")} onClick={suggest}>
          {finding ? tmarText("Finding creases…") : tmarText("Suggest creases")}
        </button>
        <button data-test="network-undo" disabled={!!d.motionActive || d.history.length === 0} title={tmarText("Undo the last edit of the network (Ctrl+Z)")} onClick={() => edit(undoNetwork)}>{tmarText("Undo")}</button>
        <button data-test="network-redo" disabled={!!d.motionActive || d.future.length === 0} title={tmarText("Redo (Ctrl+Y)")} onClick={() => edit(redoNetwork)}>{tmarText("Redo")}</button>
      </div>
      {d.suggested && (
        <p className="hint" data-test="network-suggested">
          {d.suggested.length === 0 ? tmarText("No creases found on the scan.") : tmarText("{0} crease{1} suggested, dashed — click one to take it.", [d.suggested.length, d.suggested.length === 1 ? '' : tmarText("s")])}{' '}
          {d.suggested.length > 0 && (
            <button className="chip" data-test="network-accept-all" title={tmarText("Take every crease suggested as a crease curve")} onClick={() => edit((x) => acceptCreases(x, (x.suggested ?? []).map((_, i) => i)))}>{tmarText("Accept all")}</button>
          )}{' '}
          <button className="chip" data-test="network-suggest-dismiss" title={tmarText("Put the suggestions away")} onClick={() => edit((x) => setSuggested(x, null))}>{tmarText("Dismiss")}</button>
        </p>
      )}
      {d.placing && (
        <p className="hint" data-test="network-placing">
          {d.placing.corners.length}{tmarText(" corner")}{d.placing.corners.length === 1 ? '' : tmarText("s")} —{' '}
          {d.placing.corners.length >= 3 ? tmarText("click the first corner, press Enter, double-click or middle-click to close the patch;") : d.placing.corners.length === 2 ? tmarText("one more for a patch, or Enter for a line;") : tmarText("click the next corner;")}{' '}{tmarText("Backspace takes the last back, Esc lets it go.")}</p>
      )}
      {networkStatus(report, d, len.units) !== '' && (
        <p className="hint" data-test="network-status">
          {networkStatus(report, d, len.units).split(' · ').map((part) => tmarText(part)).join(' · ')}
        </p>
      )}
      {!d.placing && d.tool === 'draw' && report && report.patches.length > 0 && (
        <p className="hint" data-test="network-editing">{tmarText("Drag a corner or an edge to change a patch; click a patch to pick it.")}</p>
      )}
      {report && report.patches.length > 0 && (
        <div className="checklist" data-test="network-patches">
          {report.patches.map((p, i) => (
            <button key={i} data-test={`network-patch-${i}`} disabled={!current} className={'netpatch' + (d.picked === i ? ' on' : '')} title={tmarText("Off the scan beyond its noise: {0} (the tolerance {1}). The patch's worst points: {2}", [len.fmt(p.misfit, 3), len.fmt(d.fit.tolerance ?? DEFAULT_TOLERANCE, 3, { bare: true }), p.worst.map((w) => `${len.fmt(w.off, 3, { signed: true })} at (${w.at.map((x) => len.fmt(x, 1, { bare: true })).join(', ')})`).join('; ')])} onClick={() => edit((x) => ({ ...x, picked: x.picked === i ? null : i }))}>{tmarText("Patch ")}{i + 1} · σ {len.fmt(p.rms, 3, { bare: true })}{tmarText(" · worst ")}{len.fmt(p.max, 3)} · {p.net.u}{tmarText(" × ")}{p.net.v}
            </button>
          ))}
        </div>
      )}
      {picked && report && d.picked !== null && (
        <>
          {stripField('Spans along', picked.sides[0]?.[0], 'network-spans-u')}
          {stripField('Spans across', picked.sides[1]?.[0], 'network-spans-v')}
          <div className="toolrow">
            <button data-test="network-delete-patch" disabled={!current} title={current ? tmarText("Take the patch out, with the edges no other patch has (Delete)") : tmarText("Wait for the build: the patches are numbered as they were before your last change")} onClick={() => edit((x) => removeReportedPatch(x, report, d.picked!))}>{tmarText("Delete patch ")}{d.picked + 1}
            </button>
          </div>
        </>
      )}
      {refused.length > 0 && (
        <div className="checklist" data-test="network-refused">
          {refused.map(({ c, i }) => (
            <p key={i} className="hint warn">{tmarText("⚠ Region at (")}{c.seed.map((x) => len.fmt(x, 1, { bare: true })).join(', ')}): {'refused' in c ? tmarText(c.refused) : ''}{' '}
              <button className="chip" data-test={`network-unfill-${i}`} title={tmarText("Empty the region: take its seed away")} onClick={() => edit((x) => removeSeed(x, i))}>{tmarText("×")}</button>
            </p>
          ))}
        </div>
      )}
      <NetworkPointFields d={d} report={report} />
      <BodySides d={d} />
      <Num label={tmarText("Smoothness")} unit="" testId="network-smooth" value={d.fit.smoothness} onCommit={(v) => edit((x) => setNetworkFit(x, { smoothness: Math.max(0, Math.abs(v)) }))} hint={tmarText("How hard the patches and their edges are held fair against the scan: 0 follows it exactly, 0.001 fairs its noise, 0.1 smooths well over it, from 1 detail goes")} />
      <Num label={tmarText("Tolerance")} testId="network-tolerance" value={d.fit.tolerance ?? DEFAULT_TOLERANCE} onCommit={(v) => edit((x) => setNetworkFit(x, { tolerance: Math.max(0, Math.abs(v)) }))} hint={tmarText("How far a patch may stray from the scan beyond its noise before Auto gives its strips more spans: they start at 4 and get more only where a patch misses by more than this, and only while that helps. Fewer spans are smoother")} />
      <label className="checkrow" title={tmarText("Fit again without the points past three sigmas of the first fit — a rib or a stray edge caught in a cell")}>
        <input type="checkbox" data-test="network-robust" checked={d.fit.robust === true} onChange={(e) => edit((x) => setNetworkFit(x, { robust: e.target.checked }))} />
        <span>{tmarText("Leave out stray points")}</span>
      </label>
    </>
  )
}

/** The faces beside a body's edge, as the body was last built: the edge
 *  found by its fingerprint, its two faces with theirs. */
function facesBeside(body: number, edge: EdgeRef): FaceInfo[] {
  const topology = reverseSession()?.topologies.get(body)
  if (!topology) return []
  const diagonal = Math.max(1, ...topology.faces.map((f) => Math.hypot(...f.fingerprint.centroid)))
  const i = matchEdge(edge, topology.edges.map((e) => e.fingerprint), matchTolerance(diagonal))
  if (i === null) return []
  return topology.edges[i].faces.flatMap((h) => topology.faces.filter((f) => f.hash === h))
}

/** The curves along a body's edge (PN11), a row each: the patch beside it
 *  meeting the body's face on its edge (Contact), or tangent to the face
 *  too — and which of the edge's two faces. */
function BodySides({ d }: { d: NetworkDraftOpen }) {
  useTmarLanguage()

  const bodies = useReverse((s) => s.bodies)
  const describeFace = describeFaceIn(useLength().units)
  const report = useNetworkReport() ?? undefined
  const along = d.curves.filter((c) => c.along)
  if (along.length === 0) return null
  const edit = (change: (x: NetworkDraftOpen) => NetworkDraftOpen) => useReverse.getState().editNetwork(change)
  return (
    <div className="checklist" data-test="network-bodies">
      {along.map((c) => {
        const body = c.along!.body
        const faces = facesBeside(body, c.along!.edge)
        const reading = report?.bodies.find((b) => b.curve === c.id)
        const value = c.side ? `${c.side.mode}|${faces.findIndex((f) => f.fingerprint.centroid.join() === c.side!.face.centroid.join())}` : 'none'
        return (
          <label key={c.id} className="field" title={tmarText("How the patch beside this curve meets the body: on the body's edge (Contact), or tangent to one of the edge's two faces as well")}>
            <span>{tmarText("Along ")}{bodies.find((b) => b.id === body)?.name ?? (tmarText("body {0}", [body]))}
              {reading ? tmarText(" · {0}°", [reading.angle.toFixed(2)]) : ''}
            </span>
            <select
              data-test={`network-side-${c.id}`}
              value={value}
              onChange={(e) => {
                const [mode, at] = e.target.value.split('|')
                const face = faces[Number(at)] ?? faces[0]
                edit((x) => setSide(x, c.id, mode === 'none' || !face ? null : { body, face: face.fingerprint, mode: mode as 'contact' | 'tangent' }))
              }}
            >
              <option value="none">{tmarText("On the edge, no face")}</option>
              {faces.map((f, i) => (
                <option key={`c${i}`} value={`contact|${i}`}>{tmarText("Contact — ")}{tmarText(describeFace(f.fingerprint))}
                </option>
              ))}
              {faces.map((f, i) => (
                <option key={`t${i}`} value={`tangent|${i}`}>{tmarText("Tangent to ")}{tmarText(describeFace(f.fingerprint))}
                </option>
              ))}
            </select>
          </label>
        )
      })}
    </div>
  )
}
