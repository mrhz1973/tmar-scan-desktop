// SPDX-License-Identifier: AGPL-3.0-only
// Reduce mesh: a light copy of the scan to model over in CAD, held within a
// tolerance, its sharp edges kept — a preview until it is applied.

import { useShallow } from 'zustand/react/shallow'
import { usePulse } from '../../../../src/app/useHints'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { NumberField } from '../../../../src/ui/NumberField'
import { useLength } from '../../../../src/app/useUnits'
import { ExportMeshButton } from '../../../../src/ui/ExportMeshButton'
import type { MeshFormat } from '../../../../src/core/exportMesh'
import { reductionStale, useMeshTools } from '../../state/meshStore'
import { count, SHARE, typedLen } from '../meshFormat'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../../src/i18n'


export function ReduceTool({
  ready,
  busy,
  onReduce,
  onApply,
  onDiscard,
  onExport,
}: {
  ready: boolean
  busy: boolean
  onReduce: () => void
  onApply: () => void
  onDiscard: () => void
  onExport: (format: MeshFormat) => void
}) {
  useTmarLanguage()

  // Only what the panel reads: the whole store would render it again on
  // every write to it, the cut preview's while its offset is dragged.
  const m = useMeshTools(
    useShallow((s) => ({
      maxTriangles: s.maxTriangles,
      message: s.message,
      report: s.report,
      setMaxTriangles: s.setMaxTriangles,
      setTolerance: s.setTolerance,
      status: s.status,
      tolerance: s.tolerance,
    })),
  )
  const stale = useMeshTools(reductionStale)
  const pulse = usePulse('reduce-mesh')
  const r = m.report
  const len = useLength()
  const mm = (v: number) => len.fmt(v, 3)
  const tol = r ? typedLen(r.settings.tolerance, len.units) : ''

  return (
    <>
      <div className="group">
        <div className="sec-head">{tmarText("Reduce mesh")}<InfoDot title={tmarText("Reducing a scan for CAD")}>
            <p>{tmarText("A scan is millions of triangles, and CAD chokes on it. This makes a light mesh to model over instead: edges collapsed wherever the surface lets them go, so a flat face ends as a few large triangles and a fillet keeps the ones it needs. The scan itself stays as it is.")}</p>
            <p>{tmarText("The result is a preview. ")}<b>{tmarText("Reduce again")}</b>{tmarText(" starts over from the mesh as it stands, not from the result, so a result that came out too coarse costs nothing. ")}<b>{tmarText("Apply")}</b>{tmarText(" makes it the edited copy, one step of the undo history, from where ")}<b>{tmarText("Use for analysis")}</b>{' '}{tmarText("takes it into every workspace.")}</p>
            <p><b>{tmarText("The tolerance")}</b>{tmarText(" decides how far it may stray. The result is not trusted but measured, both ways — every scan point to the reduced mesh, and the reduced mesh back to the scan — and wherever it strays past the tolerance the scan is pinned there and reduced again, until ")}{SHARE}{tmarText(" of each side lies within it.")}</p>
          </InfoDot>
        </div>

        <NumberField
          label={tmarText("Tolerance")}
          testId="reduce-tolerance"
          value={m.tolerance}
          step={0.01}
          min={0.0001}
          kind="length"
          disabled={busy}
          onCommit={m.setTolerance}
          hint={
            <>
              <p>{tmarText("How far the reduced mesh may stray from the scan, either side of it.")}</p>
              <p>{tmarText("It starts sized to the part. Below the scan's own scatter a tighter tolerance buys little: the reduction has to keep the noise, and keeps nearly every triangle to do it.")}</p>
            </>
          }
        />

        <NumberField
          label={tmarText("Triangle limit")}
          testId="reduce-max-triangles"
          value={m.maxTriangles}
          step={1000}
          min={4}
          unit="△"
          disabled={busy}
          onCommit={m.setMaxTriangles}
          hint={
            <>
              <p>{tmarText("What the CAD system on the other end takes. Fusion warns above about")}{' '}
                <b>10,000</b>{tmarText(" facets when a mesh is converted to BRep; SOLIDWORKS imports up to")}{' '}
                <b>500,000</b>{tmarText(" as a solid or surface body, one face per facet — and slows down long before that. As a reference to model over, most take far more.")}</p>
              <p>{tmarText("The tolerance comes first. Only when holding it needs more triangles than the limit is the mesh reduced further, to the limit — and the result then says how far it strays instead.")}</p>
            </>
          }
        />

        <button
          className={pulse ? 'primary block pulse' : 'primary block'}
          data-test="reduce-mesh"
          data-confirm={r && !stale ? undefined : 1}
          disabled={!ready || busy}
          onClick={onReduce}
        >
          {m.status === 'running' ? (
            <>
              <span className="spinner" />{tmarText("Reducing…")}</>
          ) : r ? (
            tmarText('Reduce again')
          ) : (
            tmarText('Reduce')
          )}
        </button>
        <p className="hint">{tmarText("Both figures shape the reduction, so changing them means reducing again.")}</p>
        {m.message && <p className="alarmtext">{tmarText(m.message)}</p>}
      </div>

      {r && (
        <div className="group" data-test="reduce-result">
          <div className="dro hero">
            <div className="dro-label">
              <span>{tmarText("Reduced mesh")}</span>
              <span>{r.held ? tmarText("within ±{0}", [tol]) : tmarText("past the tolerance")}</span>
            </div>
            <div className="dro-window" data-test="reduce-triangles">
              <b>{count(r.triangles)}</b>
              <span>{tmarText("TRIANGLES")}</span>
            </div>
            <div className="dro-note">{tmarText("from ")}{count(r.inputTriangles)} ·{' '}
              {((r.triangles / r.inputTriangles) * 100).toFixed(r.triangles / r.inputTriangles < 0.01 ? 2 : 1)}{tmarText(" % of the scan · ")}{count(r.vertices)}{tmarText(" vertices")}</div>
          </div>

          <div className="kv" data-test="reduce-within">
            <span className="name">{tmarText("Scan within ±")}{tol}</span>
            <b>{((r.within / r.measured) * 100).toFixed(2)} %</b>
          </div>
          <div className="kv" data-test="reduce-p999">
            <span className="name">{SHARE}{tmarText(" of the scan within")}</span>
            <b>{mm(r.p999)}</b>
          </div>
          <div className="kv">
            <span className="name">{tmarText("Furthest scan point")}</span>
            <b>{mm(r.max)}</b>
          </div>
          <div className="kv">
            <span className="name">{tmarText("Mesh off the scan, ")}{SHARE}
              <InfoDot title={tmarText("Measured both ways")}>
                <p>{tmarText("The figures above measure every scan point to the reduced mesh: detail it lost. This one measures the reduced mesh back to the scan — its vertices and the middle of each of its triangles — which catches a patch of it standing proud of a surface that is not there.")}</p>
                <p>{tmarText("Furthest: ")}{mm(r.backMax)}.</p>
              </InfoDot>
            </span>
            <b>{mm(r.backP999)}</b>
          </div>
          <div className="kv">
            <span className="name">{tmarText("RMS")}</span>
            <b>{mm(r.rms)}</b>
          </div>

          {r.capped && !r.held && (
            <p className="warnnote" data-test="reduce-capped">{tmarText("⚠ Held to ")}{count(r.settings.maxTriangles)}{tmarText(" triangles, fewer than ±")}{tol}{tmarText(" needs — ")}{SHARE}{tmarText(" of the scan is within ")}{mm(r.p999)}{tmarText(" of it instead. Raise the limit or the tolerance to have both.")}</p>
          )}
          {r.capped && r.held && (
            <p className="hint" data-test="reduce-capped">{tmarText("Reduced to the ")}{count(r.settings.maxTriangles)}{tmarText("-triangle limit, and still within ±")}{tol}.
            </p>
          )}
          {!r.capped && !r.held && (
            <p className="warnnote" data-test="reduce-not-held">
              ⚠ ±{tol}{tmarText(" could not be held everywhere — ")}{SHARE}{tmarText(" of the scan is within ")}{mm(r.p999)}{tmarText(" of it. A tolerance under the scan's own scatter leaves little to reduce.")}</p>
          )}
          {stale && (
            <p className="hint" data-test="reduce-stale">{tmarText("The settings have changed since this was reduced — reduce again to use them. Apply and the export take the mesh on screen.")}</p>
          )}

          <div className="divider" />
          <p className="hint" data-test="reduce-preview">{tmarText("A preview: nothing has changed yet. Too coarse? Tighten the tolerance and reduce again.")}</p>
          <div className="toolrow">
            <button data-test="reduce-discard" disabled={busy} onClick={onDiscard} title={tmarText("Put the reduced mesh away — the mesh it was made of is as it was")}>{tmarText("Discard")}</button>
            <ExportMeshButton
              testId="export-reduced-mesh"
              disabled={busy}
              onExport={onExport}
              title={tmarText("Save the reduced mesh as an STL or a 3MF where the part now stands — any alignment or move you applied comes with it")}
            />
            <button
              className="primary"
              data-test="reduce-apply"
              disabled={busy}
              onClick={onApply}
              title={tmarText("Make the reduced mesh the edited copy, ready for Use for analysis — Ctrl+Z puts the mesh back")}
            >{tmarText("Apply")}</button>
          </div>
        </div>
      )}
    </>
  )
}
