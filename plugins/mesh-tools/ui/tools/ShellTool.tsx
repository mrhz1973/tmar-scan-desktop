// SPDX-License-Identifier: AGPL-3.0-only
// Shell: a closed part hollowed to a wall, or an open surface thickened to
// one, on the side chosen.

import { useShallow } from 'zustand/react/shallow'
import { useLength } from '../../../../src/app/useUnits'
import { InfoDot } from '../../../../src/ui/InfoDot'
import { NumberField } from '../../../../src/ui/NumberField'
import type { ThickenSide } from '../../core/offset'
import { shellModeOf, useMeshTools } from '../../state/meshStore'
import { count, typedLen } from '../meshFormat'
import { SurveyWait } from '../SurveyWait'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../../../src/i18n'


const SIDES: { id: ThickenSide; label: string; title: string }[] = [
  { id: 'in', label: 'Inward', title: 'The wall grows behind the surface — the scanned surface stays the outside' },
  { id: 'out', label: 'Outward', title: 'The wall grows in front of the surface — the scanned surface becomes the inside' },
  { id: 'both', label: 'Both sides', title: 'Half the thickness each way — the scanned surface runs down the middle of the wall' },
]

export function ShellTool({ ready, busy, onShell }: { ready: boolean; busy: boolean; onShell: (mode: 'hollow' | 'thicken') => void }) {
  useTmarLanguage()

  // Only what the panel reads: the whole store would render it again on
  // every write to it, the cut preview's while its offset is dragged.
  const m = useMeshTools(
    useShallow((s) => ({
      editing: s.editing,
      setShellSide: s.setShellSide,
      setShellThickness: s.setShellThickness,
      setTool: s.setTool,
      shellSide: s.shellSide,
      shellSurvey: s.shellSurvey,
      shellThickness: s.shellThickness,
    })),
  )
  const survey = m.shellSurvey
  const mode = survey ? shellModeOf(survey) : null
  const len = useLength()
  const t = typedLen(m.shellThickness, len.units)
  const twice = typedLen(2 * m.shellThickness, len.units)
  const way = tmarText(m.shellSide === 'out' ? 'outward' : m.shellSide === 'both' ? 'to both sides' : 'inward')
  const n = (k: number, one: string, many: string) => `${count(k)} ${tmarText(k === 1 ? one : many)}`

  return (
    <div className="group" data-test="shell-tool">
      <div className="sec-head">{tmarText("Shell / hollow")}<InfoDot title={tmarText("Hollowing a part, or thickening a surface")}>
          <p><b>{tmarText("A closed part")}</b>{tmarText(" is hollowed: its outside stays as scanned, and an inner wall the thickness in from it all round seals a cavity — what a resin print is hollowed with. The inner wall is built from the part's distance field, not by moving the scan in: where the part is thinner than twice the wall it simply stays solid, and the wall never comes nearer the outside than the thickness. It is smoother and lighter than the scan, needing none of its detail. The cavity is sealed; open it with ")}<b>{tmarText("Boolean")}</b>{tmarText(" or")}{' '}
            <b>{tmarText("Cut")}</b>{tmarText(" if it should drain.")}</p>
          <p><b>{tmarText("An open surface")}</b>{tmarText(" — one side of a part, a sheet — is thickened into a solid: a second skin the thickness from it, ")}<b>{tmarText("inward")}</b>{tmarText(" (the scanned surface stays the outside), ")}<b>{tmarText("outward")}</b>{tmarText(" or half to ")}<b>{tmarText("both sides")}</b>{tmarText(", and a wall round every rim joining the two.")}</p>
          <p>{tmarText("A part closed but for a few small holes — no larger than Fill holes would fill — is asked to have them filled first, so it can be hollowed; thickened as it is, it would come out with a wall round every hole. ")}<b>{tmarText("Cut")}</b>{tmarText(" shows the inside without cutting.")}{' '}
            <b>{tmarText("Ctrl+Z")}</b>{tmarText(" puts the part back.")}</p>
        </InfoDot>
      </div>

      <NumberField
        label={mode === 'hollow' ? tmarText("Wall") : tmarText("Thickness")}
        testId="shell-thickness"
        value={m.shellThickness}
        step={0.5}
        min={0.001}
        kind="length"
        disabled={busy}
        onCommit={m.setShellThickness}
        hint={tmarText("The wall left round the cavity of a hollowed part, or the thickness an open surface is given. It starts at a hundred-and-twenty-fifth of the part's size — {0} for a part a hand's width across.", [len.fmt(2, 0)])}
      />

      {mode !== null && mode !== 'hollow' && (
        <div className="moderow shell-sides" role="radiogroup" aria-label={tmarText("Which way to thicken")}>
          {SIDES.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={m.shellSide === x.id}
              className={m.shellSide === x.id ? 'on' : undefined}
              data-test={`shell-side-${x.id}`}
              disabled={busy}
              onClick={() => m.setShellSide(x.id)}
              title={tmarText(x.title)}
            >
              {tmarText(x.label)}
            </button>
          ))}
        </div>
      )}

      {ready && survey === null && <SurveyWait looking="Looking at the mesh…" />}
      {survey && mode === 'hollow' && (
        <p className="hint" data-test="shell-closed">{tmarText("The mesh is closed, so it is hollowed: the outside stays as it is, and an inner wall ")}{t}{tmarText("in from it seals a cavity. Where the part is thinner than ")}{twice}{tmarText(" it stays solid.")}{survey.bad > 0 ? tmarText(" {0} shared by more than two triangles — the inside is read by which way the surface faces, and may be off there.", [n(survey.bad, 'edge is', 'edges are')]) : ''}
        </p>
      )}
      {survey && mode === 'thicken' && (
        <p className="hint" data-test="shell-open">{tmarText("The mesh is an open surface — ")}{n(survey.rims, 'open rim', 'open rims')}{tmarText(" — so it is thickened into a solid: a second skin ")}{t} {way}{tmarText(", and a wall round every rim.")}</p>
      )}
      {survey && mode === 'holes' && (
        <p className="warnnote" data-test="shell-holes">{tmarText("⚠ The mesh is closed but for ")}{n(survey.holes, 'hole', 'holes')}{tmarText(" under ")}{typedLen(survey.holeSize, len.units)}{tmarText(". Hollowing needs it closed: fill ")}{survey.holes === 1 ? tmarText("it") : tmarText("them")}{tmarText(" first — or thicken it as it is, with a wall round every hole.")}</p>
      )}

      {mode === 'holes' ? (
        <div className="toolrow">
          <button data-test="shell-thicken-anyway" disabled={!ready || busy} onClick={() => onShell('thicken')} title={tmarText("Thicken the surface as it is, a wall round every hole")}>{tmarText("Thicken as it is")}</button>
          <button className="primary" data-test="shell-fill-first" data-confirm={1} disabled={busy} onClick={() => m.setTool('holes')} title={tmarText("Go to Fill holes, to close the holes and hollow the part after")}>{tmarText("Fill holes first")}</button>
        </div>
      ) : (
        <button
          className="primary block"
          data-test="shell-run"
          data-confirm={1}
          disabled={!ready || busy || mode === null}
          onClick={() => mode && onShell(mode === 'hollow' ? 'hollow' : 'thicken')}
        >
          {m.editing ? (
            <>
              <span className="spinner" />
              {mode === 'hollow' ? tmarText("Hollowing…") : tmarText("Thickening…")}
            </>
          ) : mode === 'hollow' ? (
            tmarText('Hollow with a {0} wall', [t])
          ) : mode === 'thicken' ? (
            tmarText('Thicken {0} {1}', [t, way])
          ) : (
            tmarText('Shell')
          )}
        </button>
      )}
    </div>
  )
}
