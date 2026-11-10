// SPDX-License-Identifier: AGPL-3.0-only
// Boolean: the scan joined with, cut by or intersected with the solids the
// workspace has.

import { useSolids } from '../../../../src/app/solids'
import { useStore } from '../../../../src/state/store'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { booleanSolids, elementSolidsKey } from '../../app/booleanSolids'
import type { BooleanOp } from '../../core/boolean'
import { useMeshTools } from '../../state/meshStore'
import { count } from '../meshFormat'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../../src/i18n'


const BOOLEAN_OPS: { id: BooleanOp; label: string; title: string }[] = [
  { id: 'subtract', label: 'Subtract', title: 'Take the solid out of the mesh — a bore cut out with the cylinder modelled in it' },
  { id: 'add', label: 'Add', title: 'Add the solid to the mesh — a boss the scan is missing put back on' },
  { id: 'intersect', label: 'Intersect', title: 'Keep only what the mesh and the solid share — the part trimmed to a box' },
]

export function BooleanTool({ ready, busy, onBoolean }: { ready: boolean; busy: boolean; onBoolean: () => void }) {
  useTmarLanguage()

  const op = useMeshTools((s) => s.boolOp)
  const setOp = useMeshTools((s) => s.setBoolOp)
  const chosen = useMeshTools((s) => s.boolSolids)
  const toggleSolid = useMeshTools((s) => s.toggleBoolSolid)
  const setSolids = useMeshTools((s) => s.setBoolSolids)
  const closed = useMeshTools((s) => s.boolClosed)
  const editing = useMeshTools((s) => s.editing)
  const bySource = useSolids((s) => s.bySource)
  // Followed so the list is redrawn when a measured solid comes, goes or
  // changes; read whole below.
  useStore((s) => elementSolidsKey(s.elements))
  const solids = booleanSolids(bySource)
  const inHand = solids.filter((x) => chosen.includes(x.key)).length
  const open = closed !== null && (closed.open > 0 || closed.bad > 0)
  const edges = (n: number, what: string) => `${count(n)} ${tmarText(what + (n === 1 ? '' : 's'))}`

  return (
    <div className="group" data-test="boolean-tool">
      <div className="sec-head">{tmarText("Boolean")}<InfoDot title={tmarText("A boolean with a solid")}>
          <p>{tmarText("The mesh and a solid body made one: the solid ")}<b>{tmarText("subtracted")}</b>{tmarText(" from the mesh, ")}<b>{tmarText("added")}</b>{' '}{tmarText("to it, or the two cut down to what they share (")}<b>{tmarText("intersect")}</b>{tmarText("). Every solid on offer is drawn on the part while the tool is in hand, and faintly through it, so its whole length is in view; nothing is in hand as the tool opens — click each one to use, or tick it in the list (")}<b>{tmarText("Select all")}</b>{tmarText(" takes every one), and click it again to take it out. Those in hand take the colour of what will happen to them — red what goes, green what is added, blue what is kept. Several go as one, their union: every bore of a flange taken out in one edit, the part trimmed to what either of two boxes holds. The tool is put away once the operation is done.")}</p>
          <p>{tmarText("The solids are the cylinders, cones and spheres shown in 3D Measure — each as it is drawn there, at its ")}<b>{tmarText("Assumed Ø")}</b>{tmarText(" and out as far as it was extended — and the bodies modelled in the Reverse engineer workspace. A bore the scanner could not see to the bottom of, which the scanning software closed part way down, is cut out the way it was made: fit a cylinder to the wall the scan does show, extend it down past the bottom of the bore and up out through the surface, and subtract it here — give it the bore's design Ø as its Assumed Ø if that is what it is to come out at.")}</p>
          <p>{tmarText("A boolean needs the mesh closed: close its holes with ")}<b>{tmarText("Fill holes")}</b>{tmarText(" first. The surface the solid brings — a bore's wall and floor — has no scan under it and is grey in the")}{' '}
            <b>{tmarText("Deviation")}</b>{tmarText(" view. ")}<b>{tmarText("Ctrl+Z")}</b>{tmarText(" puts the mesh back.")}</p>
        </InfoDot>
      </div>

      <div className="moderow boolean-ops" role="radiogroup" aria-label={tmarText("Boolean operation")}>
        {BOOLEAN_OPS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={op === o.id}
            className={op === o.id ? 'on' : undefined}
            data-test={`boolean-${o.id}`}
            disabled={busy}
            title={tmarText(o.title)}
            onClick={() => setOp(o.id)}
          >
            {tmarText(o.label)}
          </button>
        ))}
      </div>

      {solids.length > 1 && (
        <div className="toolrow boolean-pick">
          <button
            data-test="boolean-select-all"
            disabled={busy || inHand === solids.length}
            title={tmarText("Put every solid on offer in hand, to go as one")}
            onClick={() => setSolids(solids.map((x) => x.key))}
          >{tmarText("Select all")}</button>
          <button
            data-test="boolean-select-none"
            disabled={busy || inHand === 0}
            title={tmarText("Take every solid out of hand")}
            onClick={() => setSolids([])}
          >{tmarText("Unselect all")}</button>
        </div>
      )}
      {solids.length > 0 && (
        <div className="boolean-solids" role="group" aria-label={tmarText("Solids")} data-test="boolean-solids">
          {solids.map((x) => (
            <label key={x.key} className="checkrow" data-test="boolean-solid" data-key={x.key}>
              <input type="checkbox" checked={chosen.includes(x.key)} disabled={busy} onChange={() => toggleSolid(x.key)} />
              <span>
                {x.name} <i>· {tmarText(x.source)}</i>
              </span>
            </label>
          ))}
        </div>
      )}
      {solids.length > 0 && (
        <p className="hint" data-test="boolean-pick-hint">
          {inHand === 0 ? solids.length === 1 ? tmarText("The solid is drawn on the part — click it to use it.") : tmarText("The {0} solids are drawn on the part — click the ones to use.", [solids.length]) : solids.length === 1 ? tmarText("The solid is in hand — a click on the part takes it out again.") : tmarText("{0} of {1} in hand{2} — a click on the part puts another in hand or takes one out.", [inHand, solids.length, inHand > 1 ? tmarText(", as one") : ''])}
        </p>
      )}
      {solids.length === 0 && (
        <p className="hint" data-test="boolean-no-solid">{tmarText("Fit a cylinder, cone or sphere in 3D Measure, or model a body in the Reverse engineer workspace. For a bore, fit a cylinder to its wall and extend it down past the bottom and out through the surface.")}</p>
      )}

      {ready && (
        <p className={'hint' + (open ? ' warn' : '')} data-test="boolean-closed">
          {closed === null ? tmarText("Looking at whether the mesh is closed…") : open ? tmarText("⚠ The mesh is not closed — {0}. A boolean needs a closed mesh: close it with Fill holes first.", [[closed.open > 0 ? edges(closed.open, 'open edge') : '', closed.bad > 0 ? edges(closed.bad, 'edge') + tmarText(' shared by more than two triangles') : ''].filter(Boolean).join(tmarText(' and '))]) : tmarText("The mesh is closed.")}
        </p>
      )}

      <button className="primary block" data-test="boolean-run" data-confirm={1} disabled={!ready || busy || inHand === 0 || open} onClick={onBoolean}>
        {editing ? (
          <>
            <span className="spinner" />{tmarText("Working…")}</>
        ) : (
          tmarText('Perform operation')
        )}
      </button>
    </div>
  )
}
