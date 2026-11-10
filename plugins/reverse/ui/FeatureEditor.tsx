// SPDX-License-Identifier: AGPL-3.0-only
// The box every feature kind past the extrude and the revolve is made and
// edited in: one case per kind — its picks, its numbers, what it does to
// the bodies — with the footer the kinds share. Lengths are shown in the
// display units; what the draft holds is millimetres.

import { useLength } from '../../../src/app/useUnits'
import { round3 } from '../../../src/core/round'
import { WORLD_AXES } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { useStore } from '../../../src/state/store'
import { Icon } from '../../../src/ui/icons'
import { InfoDot } from '../../../src/ui/InfoDot'
import { MarkTools } from '../../../src/ui/MarkTools'
import { RefPicker } from '../../../src/ui/RefPicker'
import { NameField } from '../../../src/ui/RefSelect'
import { COINCIDENCE_MM, type Relation, relationsFor, relationWords, TILT_TOLERANCE_DEG } from '../core/autoConstrain'
import { type AxisRef, type ChamferMode, constrainRefs, type SketchFeature, type SplitKeep, type SurfaceShape, type ThickenSide, type TrimTool } from '../core/features'
import { INSERT_SIZES, insertHole, insertSize } from '../core/inserts'
import { snapFitKind } from '../core/snapFace'
import { symmetryPlaneRef } from '../core/symmetryPlane'
import { chamferRadius, faceAgainstThread, maxThreadOffset, minorDiameter, sizeForFace, sizeOf, THREAD_STANDARDS, threadDepth, threadDesignation, threadName, threadProblem, threadSizes, threadsPerInch, type ThreadStandard } from '../core/thread'
import { describeEdgeIn, describeFaceIn } from '../core/topo'
import { DEFAULT_SPLIT_TOLERANCE_MM } from '../state/reDrafts'
import { DEFAULT_WALL_MM, type FeatureDraft, type FeatureDraftKind, featureDraftReady, filletModeSwitch, historyEditOf, snapDraftOf, snapPlanOf, trimToleranceFor, useReverse } from '../state/reStore'
import { AnalysisRow, BuildSays, ClearPicks, Num, OpFields, PreviewLine, StepFileKey, XyzField } from './featureFields'
import { fileSize } from './featureReading'
import { lenBare, lenShort } from './reLength'
import { PlaneSelect } from './PlaneSelect'
import { SweepFields } from './SweepFields'
import { NetworkFields } from './NetworkEditor'
import type { ReactElement } from 'react'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


/** The box of a feature on a body, or of a body from an element: one
 *  component for the eight kinds, since each is a body, a pick or a
 *  reference, and a number — with the ghost, the map and the grips the
 *  extrude has. */
export function FeatureEditor() {
  useTmarLanguage()

  const d = useReverse((s) => s.featureDraft)
  const bodies = useReverse((s) => s.bodies)
  const features = useReverse((s) => s.features)
  const preview = useReverse((s) => s.preview)
  const results = useReverse((s) => s.results)
  const elements = useStore((s) => s.elements)
  const sections = useStore((s) => s.sections)
  const len = useLength()
  const re = useReverse
  if (!d) return null
  /** A length as a row reads it, to the hundredth of a millimetre. */
  const mm = (v: number) => lenShort(v, len.units)
  /** A length to the micrometre, without its unit — a diameter after Ø. */
  const bare3 = (v: number) => lenBare(v, len.units, 3)
  const describeFace = describeFaceIn(len.units)
  const describeEdge = describeEdgeIn(len.units)
  const set = (patch: Partial<FeatureDraft>) => re.getState().setFeatureDraft(patch)
  const ready = featureDraftReady(d)
  const title: Record<FeatureDraftKind, string> = { network: 'Patch network', import: 'Import STEP', moveBody: 'Move body', offsetBody: 'Offset body', draft: 'Draft', moveFace: 'Move face', deleteFace: 'Delete face', shell: 'Shell', fillet: 'Fillet', chamfer: 'Chamfer', hole: 'Hole', thread: 'Thread', extract: 'Extract', cutPlane: 'Cut by plane', mirror: 'Mirror', boolean: 'Combine bodies', sheet: 'Sheet', split: 'Split', loft: 'Loft', sweep: 'Sweep', thicken: 'Thicken', pattern: 'Pattern', surface: 'Fit surface', trim: 'Trim' }
  const sketches = features.filter((f): f is SketchFeature => f.kind === 'sketch')
  const testKind = d.kind === 'cutPlane' ? 'cut-plane' : d.kind === 'moveFace' ? 'move-face' : d.kind === 'deleteFace' ? 'delete-face' : d.kind === 'offsetBody' ? 'offset-body' : d.kind === 'moveBody' ? 'move-body' : d.kind
  const bodySelect = (value: number | null, onChange: (id: number | null) => void, label = 'Body', testId = `${testKind}-body`) => (
    <label className="field">
      <span>{tmarText(label)}</span>
      <select data-test={testId} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{tmarText("Select…")}</option>
        {bodies.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
  const hintAxis = (key: string | null, options: { key: string; label: string; ref: AxisRef }[], chosen: string) => {
    const o = (key ? options.find((x) => x.key === key) : undefined) ?? options.find((x) => x.key === chosen)
    re.getState().setHint(o ? { kind: 'axis', ref: o.ref, sketchId: null, name: o.label } : null)
  }
  /** The mirror back on the symmetry plane the search found, after another
   *  plane was tried. */
  const takeSymmetryPlane = () => {
    const now = re.getState().featureDraft
    if (!now || now.kind !== 'mirror' || now.symmetry.status !== 'found') return
    const plane = symmetryPlaneRef(now.symmetry.plane)
    if (plane) set({ plane })
  }
  /** The found plane made a Measure element — the symmetry-plane method's
   *  own, with the search's numbers as its parameters, so it re-opens there
   *  as if it had been searched for there — and the mirror moved onto it. */
  const keepSymmetryPlane = () => {
    const now = re.getState().featureDraft
    if (!now || now.kind !== 'mirror' || now.symmetry.status !== 'found') return
    const r = now.symmetry.plane
    const store = useStore.getState()
    store.startDraft('plane')
    store.setDraftMethod('plane-symmetry')
    store.setDraftParams([...r.normal, ...r.point, r.rms, r.matched, r.sampled], `The mirror image fits the scan to σ ${len.fmt(r.rms, 4)}, found for a Mirror in Reverse engineer.`)
    const id = useStore.getState().commitDraft()
    if (id === null) {
      useStore.getState().cancelDraft()
      useStore.getState().setError('The symmetry plane could not be made an element.')
      return
    }
    const name = useStore.getState().elements.find((e) => e.id === id)?.name ?? 'Symmetry plane'
    set({ plane: { kind: 'plane', id }, symmetry: { status: 'element', name } })
  }
  let fields: ReactElement
  /** A moved face that goes into the history: no ghost from the kernel,
   *  no feature added — the box says what is edited instead. */
  let planned = false
  // A snapped face followed by a draft: previewed as a ghost of where the
  // face will lie, as a planned move is, not as one feature's build.
  let leaning = false
  switch (d.kind) {
    case 'shell':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body, faces: [] }))}
          <div className="field">
            <span>{tmarText("Open")}</span>
            <span className="picked" data-test="shell-faces">
              {d.faces.length === 0 ? tmarText("None — a closed hollow body. Click faces of the body to take them away") : tmarText("{0} face{1} picked", [d.faces.length, d.faces.length === 1 ? '' : tmarText("s")])}
              {d.faces.length > 0 && <ClearPicks kind={d.kind} />}
            </span>
          </div>
          <Num label={tmarText("Wall")} testId="shell-thickness" slot="thickness" value={d.thickness} nominal="length" onCommit={(v) => set({ thickness: Math.abs(v), thicknessFrom: 'typed' })} hint={tmarText("The wall left after the inside is taken away, inward from every face that stays. The arrow on the opened face drags it.")} />
          <p className="hint" data-test="shell-source">
            {d.thicknessFrom === 'map' ? tmarText("The wall is the Thickness map’s mean over the part.") : d.thicknessFrom === 'default' ? tmarText("No Thickness map measured — {0} to start; measure the part in Wall thickness for its own.", [mm(DEFAULT_WALL_MM)]) : tmarText("Wall as typed.")}
          </p>
        </>
      )
      break
    case 'fillet':
    case 'chamfer': {
      // A fillet at a varying radius lists its edges, each with the radius
      // at its start and at its end.
      const varying = d.kind === 'fillet' && d.mode === 'variable'
      const rows = d.kind === 'fillet' ? (d.variable ?? []) : []
      const picked = varying ? rows.length : d.edges.length
      const setRadii = (i: number, radius: [number, number]) => set({ variable: rows.map((v, j) => (j === i ? { ...v, radius } : v)) })
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body, edges: [], ...(d.kind === 'fillet' ? { variable: undefined } : {}) }))}
          {d.kind === 'fillet' ? (
            <label className="field">
              <span>{tmarText("Radius")}<InfoDot title={tmarText("Constant or variable radius")}>
                  <p>
                    <b>{tmarText("Constant")}</b>{tmarText(" rounds every edge picked at the one radius, read off the scan across the first. ")}<b>{tmarText("Variable")}</b>{tmarText(" rounds each edge from a start radius at one end to an end radius at the other, evenly along it — a round that swells along a casting's edge. Edges of one tangent chain round as one: give several of them radii of their own — R1.1 along the sides, R1.5 across the ends — the radii equal where two meet; an edge of the chain not listed runs between the radii about it. The part names each edge's Start and End by its ends; ⇄ swaps its two radii.")}</p>
                </InfoDot>
              </span>
              <select data-test="fillet-mode" value={d.mode} onChange={(e) => set(filletModeSwitch(d, e.target.value as 'constant' | 'variable'))}>
                <option value="constant">{tmarText("Constant")}</option>
                <option value="variable">{tmarText("Variable — start to end")}</option>
              </select>
            </label>
          ) : (
            <label className="field">
              <span>{tmarText("Type")}<InfoDot title={tmarText("Chamfer type")}>
                  <p>
                    <b>{tmarText("Equal distance")}</b>{tmarText(" cuts both faces back alike. ")}<b>{tmarText("Two distances")}</b>{tmarText(" cuts the reference face back by the first and the face across by the second; ")}<b>{tmarText("Distance and angle")}</b>{tmarText(" cuts the reference face back by the distance, the chamfer at the angle to it. The reference face of each edge is the face most of the edges share — a rim's top — and Flip takes the other one.")}</p>
                </InfoDot>
              </span>
              <select data-test="chamfer-mode" value={d.mode} onChange={(e) => set({ mode: e.target.value as ChamferMode })}>
                <option value="equal">{tmarText("Equal distance")}</option>
                <option value="twoDistances">{tmarText("Two distances")}</option>
                <option value="distanceAngle">{tmarText("Distance and angle")}</option>
              </select>
            </label>
          )}
          <div className="field">
            <span>{tmarText("Edges")}</span>
            <span className="picked" data-test={`${d.kind}-edges`}>
              {picked === 0 ? (varying ? tmarText("Click the edges of the body to round, each from a start radius to an end radius. Click a picked edge again to let it go") : tmarText("Click the edges of the body — a round runs on along the edges tangent to it. Click a picked edge again to let it go")) : tmarText("{0} edge{1} picked", [picked, picked === 1 ? '' : tmarText("s")])}
              {picked > 0 && <ClearPicks kind={d.kind} />}
            </span>
          </div>
          {d.kind === 'fillet' && varying && (
            <>
              {rows.map((v, i) => (
                <div className="varyedge" data-test="fillet-varying-edge" key={`${v.edge.hash}:${i}`}>
                  <div className="varyedge-head">
                    <span title={tmarText(describeEdge(v.edge.fingerprint))}>
                      {rows.length > 1 ? tmarText("{0} · ", [i + 1]) : ''}
                      {tmarText(describeEdge(v.edge.fingerprint))}
                    </span>
                    <button data-test={`fillet-varying-swap-${i}`} title={tmarText("Swap the two radii — the start radius at the other end")} onClick={() => setRadii(i, [v.radius[1], v.radius[0]])}>
                      ⇄
                    </button>
                  </div>
                  <Num label={tmarText("Start")} testId={`fillet-varying-start-${i}`} value={v.radius[0]} nominal="radius" onCommit={(r) => setRadii(i, [Math.abs(r), v.radius[1]])} hint={tmarText("The radius at the edge's start — the end named Start on the part")} />
                  <Num label={tmarText("End")} testId={`fillet-varying-end-${i}`} value={v.radius[1]} nominal="radius" onCommit={(r) => setRadii(i, [v.radius[0], Math.abs(r)])} hint={tmarText("The radius at the edge's other end; the round runs evenly from the one to the other")} />
                </div>
              ))}
              <p className="hint" data-test="fillet-varying-hint">
                {rows.length === 0 ? tmarText("Each edge clicked starts at the radius the last one has; type its two radii over.") : tmarText("The part names each edge's Start and End, with the radius there{0}. An edge picked where a listed one ends starts at its radius there: along one tangent chain the radius cannot jump, and an edge of the chain not listed runs between the radii about it.", [rows.length > 1 ? tmarText(" — numbered as listed here") : ''])}
                {d.edges.length > 0 && (tmarText(" And {0} at R {1}, kept — Constant shows {2}.", [d.edges.length === 1 ? tmarText("an edge") : tmarText("{0} edges", [d.edges.length]), mm(d.radius), d.edges.length === 1 ? tmarText("it") : tmarText("them")]))}
              </p>
            </>
          )}
          {d.kind === 'fillet' && !varying ? (
            <>
              <Num label={tmarText("Radius")} testId="fillet-radius" slot="radius" value={d.radius} nominal="radius" onCommit={(v) => set({ radius: Math.abs(v), radiusTyped: true })} hint={tmarText("Read off the scan across the first picked edge; type your own to keep it. The arrow on the edge drags it.")} />
              <p className={'hint' + (d.estimate.status === 'none' ? ' warn' : '')} data-test="fillet-estimate">
                {d.radiusTyped && (tmarText("Radius as typed."))}
                {!d.radiusTyped && d.estimate.status === 'idle' && (tmarText("Pick an edge and the radius is read off the scan there."))}
                {!d.radiusTyped && d.estimate.status === 'working' && (tmarText("Reading the round off the scan…"))}
                {!d.radiusTyped && d.estimate.status === 'found' && (tmarText("Radius {0} read off the scan across the first edge ({1} section points).", [len.fmt(d.estimate.radius, 2), d.estimate.points]))}
                {!d.radiusTyped && d.estimate.status === 'none' && (tmarText("No round found on the scan at the first edge — {0} to start.", [mm(d.radius)]))}
              </p>
              {rows.length > 0 && (
                <p className="hint" data-test="fillet-varying">{tmarText("And ")}{rows.length === 1 ? tmarText("an edge") : tmarText("{0} edges", [rows.length])}{tmarText(" at a varying radius — ")}{rows.map((v) => `${mm(v.radius[0])} → ${mm(v.radius[1])}`).join(', ')}{tmarText(" — kept; Variable shows ")}{rows.length === 1 ? tmarText("it") : tmarText("them")}.
                </p>
              )}
            </>
          ) : null}
          {d.kind === 'chamfer' && (
            <>
              <Num
                label={d.mode === 'equal' ? tmarText("Distance") : tmarText("Distance 1")}
                testId="chamfer-distance"
                slot="distance"
                value={d.distance}
                nominal="length"
                onCommit={(v) => set({ distance: Math.abs(v) })}
                hint={d.mode === 'equal' ? tmarText("How far back from the edge each face is cut. The arrow on the edge drags it.") : tmarText("How far back from the edge the reference face is cut. The arrow on the edge drags it.")}
              />
              {d.mode === 'twoDistances' && <Num label={tmarText("Distance 2")} testId="chamfer-distance2" slot="distance2" value={d.distance2} nominal="length" onCommit={(v) => set({ distance2: Math.abs(v) })} hint={tmarText("How far back from the edge the face across from the reference is cut.")} />}
              {d.mode === 'distanceAngle' && <Num label={tmarText("Angle")} unit="°" testId="chamfer-angle" slot="angleDeg" value={d.angleDeg} nominal="angle" onCommit={(v) => set({ angleDeg: Math.min(89.9, Math.max(0.1, Math.abs(v))) })} hint={tmarText("Degrees between the chamfer and the reference face, under 90 — 45° on a square edge is the equal chamfer.")} />}
              {d.mode !== 'equal' && (
                <label className="checkrow" title={tmarText("Measure from the other face of each edge: the distances swap sides, the angle is read off the other face")}>
                  <input type="checkbox" data-test="chamfer-flip" checked={d.flip} onChange={(e) => set({ flip: e.target.checked })} />
                  <span>{tmarText("Flip — the other face is the reference")}</span>
                </label>
              )}
            </>
          )}
          {!varying && (
            <label className="checkrow">
              <input type="checkbox" data-test={`${d.kind}-chain`} checked={d.chain} onChange={(e) => set({ chain: e.target.checked })} />
              <span>{tmarText("Tangent propagation")}<InfoDot title={tmarText("Tangent propagation")}>
                  <p>{tmarText("The ")}{tmarText(d.kind)}{tmarText(" runs on along every edge that leaves a picked one smoothly — all the way round a rounded rectangle from one click on its rim. The edges it reaches are lit in a lighter green on the part. Off, only the edges clicked are taken.")}</p>
                </InfoDot>
              </span>
            </label>
          )}
        </>
      )
      break
    }
    case 'deleteFace':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body, faces: [] }))}
          <div className="field">
            <span>{tmarText("Faces")}</span>
            <span className="picked" data-test="delete-face-faces">
              {d.faces.length === 0 ? tmarText("Click a face of the round, the hole or the boss to take off") : tmarText("{0} face{1} picked", [d.faces.length, d.faces.length === 1 ? '' : tmarText("s")])}
              {d.faces.length > 0 && <ClearPicks kind={d.kind} />}
            </span>
          </div>
          <label className="checkrow">
            <input type="checkbox" data-test="delete-face-tangent" checked={d.tangent} onChange={(e) => set({ tangent: e.target.checked })} />
            <span>{tmarText("Tangent faces")}<InfoDot title={tmarText("What a click takes")}>
                <p>{tmarText("A click takes the face, the faces it is split from on its own surface — both halves of a bore — and every face the picked ones close in on all sides: a blind hole's floor, a boss's top. With Tangent faces on, a click on a round also takes the rounds that run on from it smoothly — a fillet's whole chain, up to the flats either side — and a bore's or a boss's wall the round at its mouth or foot. Click a picked face again to let go of what that click took.")}</p>
              </InfoDot>
            </span>
          </label>
          <p className="hint" data-test="delete-face-hint">{tmarText("The faces are taken off and the faces round them run on to close the gap, each on its own surface. Pick every face of what is to go — a chamfer's faces one by one, or Shift+drag a window over them.")}</p>
        </>
      )
      break
    case 'draft':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body, neutral: null, faces: [] }))}
          <label className="field">
            <span>{tmarText("Neutral")}<InfoDot title={tmarText("The neutral plane")}>
                <p>{tmarText("Where the leaned faces keep their place: they turn about the line in which they meet this plane. Click a flat face of the body — the face the part stands on in its mould, usually — or choose a plane. A positive angle leans the faces in as they go away from it.")}</p>
              </InfoDot>
            </span>
            <PlaneSelect value={d.neutral && d.neutral.kind !== 'face' ? d.neutral : null} testId="draft-neutral" placeholder={d.neutral?.kind === 'face' ? tmarText(describeFace(d.neutral.face)) : d.neutral?.kind === 'fitted' ? (d.neutral.label ?? (tmarText("a fitted plane"))) : tmarText("Click a flat face of the body, or choose…")} onChange={(neutral) => set({ neutral })} />
          </label>
          {d.neutral !== null && (
            <div className="toolrow">
              <button data-test="draft-neutral-clear" title={tmarText("Pick the neutral plane again — the next flat face clicked is it")} onClick={() => set({ neutral: null })}>{tmarText("Pick another neutral face")}</button>
            </div>
          )}
          <div className="field">
            <span>{tmarText("Faces")}</span>
            <span className="picked" data-test="draft-faces">
              {d.neutral === null ? tmarText("First the neutral face") : d.faces.length === 0 ? tmarText("Click the faces of the body to lean") : tmarText("{0} face{1} picked", [d.faces.length, d.faces.length === 1 ? '' : tmarText("s")])}
              {d.faces.length > 0 && <ClearPicks kind={d.kind} />}
            </span>
          </div>
          <Num label={tmarText("Angle")} unit="°" testId="draft-angle" slot="angleDeg" value={d.angleDeg} nominal="angle" onCommit={(v) => set({ angleDeg: v })} hint={tmarText("Degrees the faces lean in as they go away from the neutral plane; negative leans them out")} />
          {(d.groups?.length ?? 0) > 0 && (
            <p className="hint" data-test="draft-groups" title={tmarText("More faces at angles of their own, set through the commands (groups); kept as they are when this box is applied")}>{tmarText("Then ")}{d.groups!.map((g) => tmarText('{0} face{1} at {2}°', [g.faces.length, g.faces.length === 1 ? '' : 's', Math.round(g.angleDeg * 100) / 100])).join(', ')}.
            </p>
          )}
        </>
      )
      break
    case 'moveFace': {
      const one = d.faces.length === 1 ? d.faces[0] : null
      const several = d.faces.length > 1
      const round = one?.fingerprint.kind === 'cylinder'
      const allRound = d.faces.length > 0 && d.faces.every((f) => f.fingerprint.kind === 'cylinder')
      const radius = round ? one.fingerprint.radius : undefined
      const snapping = d.snap && one !== null
      const plan = snapPlanOf(d, features, elements, len.units)
      const edit = historyEditOf(d, features, elements, len.units)
      planned = edit !== null
      const lean = d.reading?.draft ?? null
      leaning = snapDraftOf(d) !== null
      fields = (
        <>
          <div className="field">
            <span>{several ? tmarText("Faces") : tmarText("Face")}</span>
            <span className="picked" data-test="move-face-face">
              {d.faces.length === 0 ? tmarText("Click the faces of the body to move — flat or round ones") : one ? describeFace(one.fingerprint) : tmarText("{0} faces picked", [d.faces.length])}
              {d.faces.length > 0 && <ClearPicks kind={d.kind} />}
            </span>
          </div>
          {one && snapFitKind(one.fingerprint) && (
            <div className="toolrow">
              <button
                data-test="move-face-snap"
                className={snapping ? 'on' : ''}
                aria-pressed={snapping}
                title={snapping ? tmarText("Click faces of the body again — to add to the move, or to let one go") : tmarText("Read the move off the scan: click the scan where this face should lie, and a plane or a cylinder fitted there says how far")}
                onClick={() => set({ snap: !snapping, error: null })}
              >
                {snapping ? tmarText("Pick faces instead") : tmarText("Snap to scan")}
              </button>
            </div>
          )}
          <Num
            label={allRound ? tmarText("Radius by") : several ? tmarText("Offset") : tmarText("Move by")}
            testId="move-face-offset" slot="offset"
            value={d.offset}
            nominal="length"
            onCommit={(v) => set({ offset: v, reading: null })}
            hint={
              several ? tmarText("How far every picked face moves: a flat face along its outward normal — out adds to the body, in cuts into it — a round face in radius, a boss and a bore alike. A cylinder’s wall and its two ends together make it longer and wider at once.") : round ? tmarText("The change of the round face’s radius, the axis kept: a hole bored out or sleeved, a boss built up or turned down. Typed, dragged by the arrow, or read off a cylinder fitted where the scan was clicked.") : tmarText("How far along the face’s outward normal: out adds to the body, in cuts into it, the walls round the face running on as they stand. Typed, dragged by the arrow, or read off a plane fitted where the scan was clicked.")
            }
          />
          {radius !== undefined && (
            <p className="hint" data-test="move-face-diameter">{tmarText("Ø ")}{mm(2 * radius)} → {mm(2 * (radius + d.offset))}
            </p>
          )}
          <p className={'hint' + (d.error ? ' warn' : '')} data-test="move-face-reading">
            {d.error && (tmarText("⚠ {0}", [tmarText(d.error)]))}
            {!d.error && d.fitting && (
              <>
                <span className="spinner" />{tmarText(" Fitting the scan where you clicked…")}</>
            )}
            {!d.error && !d.fitting && d.faces.length === 0 && (tmarText("Click the faces to move — one, or several to offset them together: a cylinder’s wall and both its ends, every face of a block. Shift+drag a window takes many at once."))}
            {!d.error && !d.fitting && snapping && !d.reading && (tmarText("Now click the scan where this face should lie — or type how far it moves."))}
            {!d.error && !d.fitting && !snapping && d.faces.length > 0 && ((several ? tmarText("Click a face to add it or to let it go.") : tmarText("Type how far the face moves, or drag the arrow — or take Snap to scan and click the scan where it should lie. Click more faces to move them together.")))}
            {!d.error && !d.fitting && snapping && d.reading && (
              <>{tmarText("Read off the scan: a ")}{round ? tmarText("cylinder") : tmarText("plane")}{tmarText(" fitted to σ ")}{len.fmt(d.reading.sigma, 3)}
                {round ? tmarText(", its radius {0} {1}", [len.fmt(Math.abs(d.reading.offset), 3), d.reading.offset >= 0 ? tmarText("larger") : tmarText("smaller")]) : tmarText(", {0} {1} the face", [len.fmt(Math.abs(d.reading.offset), 3), d.reading.offset >= 0 ? tmarText("outside") : tmarText("inside")])}.
                {lean ? tmarText(" The scan's face leans {0}° to this one — more than its scatter accounts for ({1}°) — and the move alone keeps the body's direction.", [lean.angleDeg.toFixed(2), lean.noiseDeg < 0.005 ? tmarText("under 0.01") : lean.noiseDeg.toFixed(2)]) : d.reading.tiltDeg > 0.5 && (tmarText(" The scan's face is turned {0}° to this one — the move keeps the body's direction.", [d.reading.tiltDeg.toFixed(1)]))}
                {d.reading.axisShift !== undefined && d.reading.axisShift > 0.1 && (tmarText(" Its axis stands {0} off this one's — the move keeps the body's axis.", [len.fmt(d.reading.axisShift, 2)]))}
              </>
            )}
          </p>
          {lean && d.featureId === undefined && (
            <label className="checkrow" title={tmarText("A Draft feature after the move: the moved face turns {0}° about the line across its middle where the scan's plane crosses it, and lies on the scan. A moulded wall modelled square gets its draft this way. Everything built after builds on the leaned face; one Ctrl+Z takes the move and the draft back together.", [lean.angleDeg.toFixed(2)])}>
              <input type="checkbox" data-test="move-face-lean" checked={d.lean} onChange={(e) => set({ lean: e.target.checked })} />
              <span>{tmarText("Draft it as well, by ")}{lean.angleDeg.toFixed(2)}°</span>
            </label>
          )}
          {plan && plan.route !== 'direct' && (
            <label className="checkrow" title={tmarText("Change what made the face — the extrude's distance, the sketch's line or circle — as you would by hand, instead of adding a Move face: the rounds, shells and cuts after it build again on the moved wall")}>
              <input type="checkbox" data-test="move-face-history" checked={d.kind === 'moveFace' && d.history} onChange={(e) => set({ history: e.target.checked })} />
              <span>{tmarText("Change what made ")}{several ? tmarText("them") : tmarText("it")}{tmarText(" instead")}</span>
            </label>
          )}
          {plan && (
            <p className="hint" data-test="move-face-plan">
              {edit ? tmarText("Create edits {0} — no Move face is added. Everything built after it — rounds, shells, cuts — builds again on the moved {1}; Ctrl+Z takes it back.", [tmarText(edit.text), several ? tmarText("faces") : tmarText("face")]) : tmarText("A Move face on the body: the walls round {0} must stand square to it, and rounds on {1} do not follow{2}", [several ? tmarText("each face") : tmarText("the face"), several ? tmarText("their rims") : tmarText("its rim"), plan.route === 'direct' ? tmarText(" — what made {0} cannot be changed instead, since {1}.", [several ? tmarText("them") : tmarText("it"), tmarText(plan.why)]) : tmarText(" — tick the box to change {0} instead, and they do.", [tmarText(plan.text.split(':')[0])])])}
              {leaning && lean && (tmarText(" Then a Draft leans the moved face {0}° onto the scan's plane, about the line across its middle — one Ctrl+Z takes both back.", [lean.angleDeg.toFixed(2)]))}
            </p>
          )}
        </>
      )
      break
    }
    case 'hole': {
      const options = elements
        .filter((e) => e.fit && (e.fit.kind === 'cylinder' || e.fit.kind === 'circle' || e.fit.kind === 'line'))
        .map((e) => ({ key: `element:${e.id}`, label: e.name, ref: { kind: 'element', id: e.id } as AxisRef }))
      const chosen = d.axis?.kind === 'element' ? `element:${d.axis.id}` : ''
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <label className="field">
            <span>{tmarText("Along")}</span>
            <RefPicker
              value={chosen || null}
              options={options.map((o) => ({ key: o.key, label: o.label, group: 'Elements' }))}
              placeholder={d.axis?.kind === 'face' ? tmarText(describeFace(d.axis.face)) : d.axis?.kind === 'point' ? tmarText("{0}, at its centre", [tmarText(describeFace(d.axis.face))]) : tmarText("Click a round face — or a flat one to drill into at its centre — or choose…")}
              testId="hole-axis"
              onChange={(key) => {
                const id = Number(key.split(':')[1])
                const fit = elements.find((e) => e.id === id)?.fit
                const radius = fit && (fit.kind === 'cylinder' || fit.kind === 'circle') ? fit.radius : d.radius
                set({ axis: { kind: 'element', id }, radius })
              }}
              onHover={(key) => hintAxis(key, options, chosen)}
            />
          </label>
          <label className="field" title={tmarText("Size the hole for a heat-set insert: its hole diameter, and a millimetre deeper than the insert is long")}>
            <span>{tmarText("Insert")}</span>
            <select
              data-test="hole-insert"
              value={d.insert ?? ''}
              onChange={(e) => {
                const size = insertSize(e.target.value)
                set(size ? { insert: size.label, ...insertHole(size) } : { insert: null })
              }}
            >
              <option value="">{tmarText("None — a plain hole")}</option>
              {INSERT_SIZES.map((z) => (
                <option key={z.label} value={z.label}>
                  {tmarText("{0} — Ø {1} × {2}{3}", [tmarText(z.label), bare3(z.hole), bare3(z.length), len.units === 'mm' ? '' : tmarText(" {0}", [len.word()])])}
                </option>
              ))}
            </select>
          </label>
          <Num label={tmarText("Diameter")} testId="hole-diameter" slot="diameter" value={2 * d.radius} nominal={d.insert ? undefined : 'length'} onCommit={(v) => set({ radius: Math.abs(v) / 2, insert: null })} hint={tmarText("The hole's diameter — the element's, to start")} />
          <label className="checkrow">
            <input type="checkbox" data-test="hole-through" checked={d.depth === null} onChange={(e) => set({ depth: e.target.checked ? null : len.fromDisplay(len.step(10)), insert: null })} />
            <span>{tmarText("Through all")}</span>
          </label>
          {d.depth !== null && <Num label={tmarText("Depth")} testId="hole-depth" slot="depth" value={d.depth} nominal={d.insert ? undefined : 'length'} onCommit={(v) => set({ depth: Math.abs(v), insert: null })} hint={d.axis?.kind === 'point' ? tmarText("How far into the body from the face") : tmarText("How far each way along the axis from its point")} />}
          {d.insert && insertSize(d.insert) && <p className="hint" data-test="hole-insert-wall">{tmarText("Leave at least ")}{mm(insertSize(d.insert)!.wall)}{tmarText(" of wall round it — a boss of Ø ")}{lenBare(insertSize(d.insert)!.hole + 2 * insertSize(d.insert)!.wall, len.units, 1)}{tmarText(" or more.")}</p>}
        </>
      )
      break
    }
    case 'thread': {
      const sizes = threadSizes(d.standard)
      const size = sizeOf(d.standard, d.diameter)
      const pitchListed = size?.pitches.find((p) => Math.abs(p - d.pitch) < 1e-4)
      const problem = threadProblem(d, len.units)
      const fp = d.face?.fingerprint
      const side = d.internal === null ? '' : d.internal ? ' · a bore: a nut’s thread' : ' · a boss: a bolt’s thread'
      // The face drawn another size than the thread is brought to it.
      const against = fp?.radius && d.internal !== null ? faceAgainstThread(d, d.internal, 2 * fp.radius) : null
      const brought = !against || !fp?.radius ? '' : ` · the Ø${bare3(2 * fp.radius)} ${d.internal ? 'bore' : 'boss'} ${d.internal ? (against === 'wider' ? 'filled in to the minor' : 'bored out to the minor') : against === 'wider' ? 'turned down to the major' : 'built up to the major'}`
      /** The size a standard offers for the face — its own for the face
       *  while none was chosen, else the one nearest the diameter. */
      const sizeIn = (standard: ThreadStandard): { diameter: number; pitch: number } => {
        if (!d.sized && fp?.radius && d.internal !== null) return sizeForFace(standard, 2 * fp.radius, d.internal)
        const near = threadSizes(standard).reduce((a, b) => (Math.abs(b.diameter - d.diameter) < Math.abs(a.diameter - d.diameter) ? b : a))
        return { diameter: near.diameter, pitch: near.pitches[0] }
      }
      fields = (
        <>
          <div className="field">
            <span>{tmarText("Face")}</span>
            <b data-test="thread-face" style={{ fontSize: 12 }}>
              {fp ? tmarText("{0}{1}", [tmarText(describeFace(fp)), tmarText(side)]) : tmarText("Click a round face of the body")}
            </b>
          </div>
          <label className="field">
            <span>{tmarText("Type")}</span>
            <select
              data-test="thread-standard"
              value={d.standard}
              onChange={(e) => {
                const standard = e.target.value as ThreadStandard
                set({ standard, ...sizeIn(standard) })
              }}
            >
              {THREAD_STANDARDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {tmarText(s.label)}
                </option>
              ))}
            </select>
          </label>
          {d.standard === 'print45' && (
            <p className="hint" data-test="thread-print-hint">{tmarText("45° flanks, a flat crest and root: printed with the axis upright, nothing overhangs past 45°. It mates only with itself.")}</p>
          )}
          <label className="field">
            <span>{tmarText("Size")}</span>
            <select
              data-test="thread-size"
              value={size ? String(size.diameter) : ''}
              onChange={(e) => {
                const s = sizes.find((x) => String(x.diameter) === e.target.value)
                if (s) set({ diameter: s.diameter, pitch: s.pitches[0], sized: true })
              }}
            >
              {!size && <option value="">{tmarText("Custom Ø")}{bare3(d.diameter)}</option>}
              {sizes.map((s) => (
                <option key={s.label} value={String(s.diameter)}>
                  {d.standard === 'metric' || d.standard === 'print45' ? tmarText(s.label) : tmarText("{0} — Ø{1}", [tmarText(s.label), bare3(s.diameter)])}
                </option>
              ))}
            </select>
          </label>
          {size && (
            <label className="field">
              <span>{tmarText("Designation")}</span>
              <select
                data-test="thread-designation"
                value={pitchListed !== undefined ? String(pitchListed) : ''}
                onChange={(e) => {
                  const pitch = Number(e.target.value)
                  if (pitch > 0) set({ pitch, sized: true })
                }}
              >
                {pitchListed === undefined && <option value="">{tmarText("Custom pitch ")}{len.fmt(d.pitch, 3)}</option>}
                {size.pitches.map((p, i) => (
                  <option key={p} value={String(p)}>
                    {threadDesignation(d.standard, size.diameter, p)}
                    {d.standard === 'metric' && size.pitches.length > 1 ? (i === 0 ? tmarText(" — coarse") : tmarText(" — fine")) : d.standard === 'print45' ? (i === 0 ? tmarText(" — ISO coarse depth") : tmarText(" — ISO coarse pitch")) : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Num label={tmarText("Diameter")} testId="thread-diameter" slot="diameter" value={round3(d.diameter)} onCommit={(v) => set({ diameter: Math.abs(v), sized: true })} hint={tmarText("The major diameter — a bolt's outside, a nut's at the bottom of its thread. Typed, the thread is cut to it, whatever the table has.")} />
          <Num
            label={tmarText("Pitch")}
            testId="thread-pitch" slot="pitch"
            value={round3(d.pitch)}
            onCommit={(v) => set({ pitch: Math.abs(v), sized: true })}
            hint={tmarText("How far the thread climbs in a turn — {0} {1} is {2} threads per inch.", [bare3(d.pitch), len.word(), Math.round(threadsPerInch(d.pitch) * 100) / 100])}
          />
          <label className="field">
            <span>{tmarText("Direction")}</span>
            <select data-test="thread-hand" value={d.leftHanded ? 'left' : 'right'} onChange={(e) => set({ leftHanded: e.target.value === 'left' })}>
              <option value="right">{tmarText("Right hand")}</option>
              <option value="left">{tmarText("Left hand")}</option>
            </select>
          </label>
          <label className="checkrow">
            <input type="checkbox" data-test="thread-full" checked={d.fullLength} onChange={(e) => set({ fullLength: e.target.checked })} />
            <span>{tmarText("Full length")}</span>
          </label>
          {!d.fullLength && (
            <>
              <Num label={tmarText("Length")} testId="thread-length" slot="length" value={d.length} nominal="length" onCommit={(v) => set({ length: Math.abs(v) })} hint={tmarText("How far along the face the thread runs")} />
              <Num label={tmarText("Start")} testId="thread-start" slot="start" value={d.start} onCommit={(v) => set({ start: Math.abs(v) })} hint={tmarText("How far in from the end of the face the thread starts — the end further along the face's axis, or the other one with the box below ticked")} />
              <label className="checkrow">
                <input type="checkbox" data-test="thread-flip" checked={d.flip} onChange={(e) => set({ flip: e.target.checked })} />
                <span>{tmarText("From the other end")}</span>
              </label>
            </>
          )}
          <label className="checkrow" title={tmarText("A 45° chamfer across the thread where it comes out of the body free — a bolt's tip, a bore's mouth at either side of a nut — from just past the root out through the crests, so the thread starts clean instead of on a knife-edge first turn. Not where the thread ends against a shoulder or a bore's floor, or short of the face's end.")}>
            <input type="checkbox" data-test="thread-chamfer" checked={d.chamfer} onChange={(e) => set({ chamfer: e.target.checked })} />
            <span>{tmarText("Chamfer the free ends (45°)")}</span>
          </label>
          <Num
            label={tmarText("Offset")}
            testId="thread-offset" slot="offset"
            value={d.offset}
            onCommit={(v) => set({ offset: Math.abs(v) })}
            hint={tmarText("A clearance for 3D printing: every face of the thread — the flanks, the crest and the root — moved into the material by this much, so a printed bolt turns into a printed nut. Small values only: under {0} at this pitch, where the tooth would have nothing left at the pitch diameter. A tenth or two of a millimetre is a usual start — half each on a printed bolt and nut.", [mm(maxThreadOffset(d.pitch, d.standard))])}
          />
          <p className="hint" data-test="thread-reading">
            {threadName(d.standard, d.diameter, d.pitch)}
            {d.leftHanded ? tmarText(" left-hand") : ''}{tmarText(" · major Ø")}{bare3(d.diameter)}{tmarText(" · minor Ø")}{bare3(minorDiameter(d.diameter, d.pitch, d.standard))} · {bare3(threadDepth(d.pitch, d.standard))} {len.word()}{tmarText(" deep")}{tmarText(brought)}
            {d.offset > 0 ? tmarText(" · {0} {1} off every face", [bare3(d.offset), len.word()]) : ''}
            {d.chamfer ? (d.internal === null ? tmarText(" · chamfered at the free ends") : tmarText(" · {0} to Ø{1} at the free ends", [d.internal ? tmarText("countersunk") : tmarText("chamfered"), bare3(2 * chamferRadius(d, d.internal))])) : ''}
          </p>
          {problem && (
            <p className="hint warn" data-test="thread-problem">
              ⚠ {tmarText(problem)}
            </p>
          )}
        </>
      )
      break
    }
    case 'extract': {
      const options = elements.filter((e) => e.fit && (e.fit.kind === 'plane' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone' || e.fit.kind === 'sphere' || e.fit.kind === 'torus'))
      // A shadow section stands as its block, through the part's thickness.
      const shadows = sections.filter((x) => x.kind === 'shadow')
      const chosen = d.section === null ? options.find((e) => e.id === d.element) : undefined
      const shadow = d.section === null ? undefined : shadows.find((x) => x.id === d.section)
      const targets = bodies.filter((b) => !b.surface)
      const value = d.section !== null ? `section:${d.section}` : d.element !== null ? `element:${d.element}` : ''
      const pick = (v: string) => {
        const [what, id] = v.split(':')
        set(what === 'section' ? { section: Number(id), element: null } : what === 'element' ? { element: Number(id), section: null } : { element: null, section: null })
      }
      const ext = shadow?.cut?.shadow?.extent
      fields = (
        <>
          <label className="field">
            <span>{tmarText("From")}</span>
            <select data-test="extract-element" value={value} onChange={(e) => pick(e.target.value)}>
              <option value="">{tmarText("Click an element on the part, or select…")}</option>
              {options.length > 0 && (
                <optgroup label={tmarText("Elements")}>
                  {options.map((e) => (
                    <option key={e.id} value={`element:${e.id}`}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {shadows.length > 0 && (
                <optgroup label={tmarText("Shadow sections")}>
                  {shadows.map((x) => (
                    <option key={x.id} value={`section:${x.id}`} data-test={`extract-section-${x.id}`}>
                      {x.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {shadow && (
            <p className="hint" data-test="extract-shadow-hint">
              {ext ? tmarText("The outline stood up through the part, {0} thick — it follows the shadow as 3D Measure takes it again.", [mm(ext.max - ext.min)]) : tmarText("The shadow is still being taken.")}
            </p>
          )}
          {chosen?.fit?.kind === 'plane' && <Num label={tmarText("Thickness")} testId="extract-thickness" slot="thickness" value={d.thickness} nominal="length" onCommit={(v) => set({ thickness: Math.abs(v) })} hint={tmarText("A plane becomes a slab this thick, centred on it")} />}
          <OpFields op={d.op} canCut={targets.length > 0} testPrefix="extract" onOp={(op) => set({ op })} />
        </>
      )
      break
    }
    case 'cutPlane':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <label className="field">
            <span>{tmarText("At")}</span>
            <PlaneSelect value={d.plane} testId="cut-plane-plane" placeholder={tmarText("Choose the plane…")} onChange={(plane) => set({ plane })} />
          </label>
          <button className="block withicon" data-test="cut-plane-flip" onClick={() => set({ keep: d.keep > 0 ? -1 : 1 })}>
            <Icon name="flip" size={16} />{tmarText("Keep the other side")}</button>
        </>
      )
      break
    case 'mirror':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <label className="field">
            <span>{tmarText("About")}</span>
            <PlaneSelect value={d.plane && d.plane.kind !== 'face' ? d.plane : null} testId="mirror-plane" placeholder={d.plane?.kind === 'face' ? tmarText(describeFace(d.plane.face)) : tmarText("Click a flat face of the body, or choose…")} onChange={(plane) => set({ plane })} />
          </label>
          {d.symmetry.status === 'working' && (
            <p className="hint" data-test="mirror-symmetry">
              <span className="spinner" />{tmarText(" Looking for the scan's own symmetry plane…")}</p>
          )}
          {d.symmetry.status === 'found' && (
            <p className="hint" data-test="mirror-symmetry">
              {d.plane?.kind === 'fitted' && d.plane.label ? tmarText("Set to the scan’s own symmetry plane") : tmarText("The scan has a symmetry plane")}{tmarText(": its mirror image lies on the scan to σ ")}{len.fmt(d.symmetry.plane.rms, 3)}{tmarText(" over ")}{d.symmetry.plane.matched.toLocaleString('en-US')}{tmarText(" of ")}{d.symmetry.plane.sampled.toLocaleString('en-US')}{tmarText(" samples.")}{' '}
              {!(d.plane?.kind === 'fitted' && d.plane.label) && (
                <button className="chip nominal" data-test="mirror-symmetry-use" onClick={() => takeSymmetryPlane()}>{tmarText("Use it")}</button>
              )}{' '}
              <button className="chip nominal" data-test="mirror-symmetry-keep" title={tmarText("Make it a plane element in 3D Measure — Symmetry plane — for sketches, sections and dimensions to stand on; the mirror then refers to the element")} onClick={() => keepSymmetryPlane()}>{tmarText("Keep as a plane element")}</button>
            </p>
          )}
          {d.symmetry.status === 'element' && (
            <p className="hint" data-test="mirror-symmetry">{tmarText("Set to ")}{d.symmetry.name}{tmarText(", the symmetry plane measured on this scan.")}</p>
          )}
          {d.symmetry.status === 'none' && (
            <p className="hint" data-test="mirror-symmetry">{tmarText("The scan has no symmetry plane of its own")}{d.symmetry.rms !== null ? tmarText(" (the best mirror image stands off it by σ {0})", [len.fmt(d.symmetry.rms, 2)]) : ''}{tmarText(" — click a flat face of the body or choose a plane.")}</p>
          )}
          <label className="checkrow">
            <input type="checkbox" data-test="mirror-join" checked={d.join} onChange={(e) => set({ join: e.target.checked })} />
            <span>{tmarText("Join with the source")}</span>
          </label>
        </>
      )
      break
    case 'sheet':
      fields = (
        <>
          <label className="field">
            <span>{tmarText("Sketch")}</span>
            <select data-test="sheet-sketch" value={d.sketchId ?? ''} onChange={(e) => set({ sketchId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{tmarText("Select…")}</option>
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Num label={tmarText("From")} testId="sheet-from" slot="from" value={d.from} nominal="length" onCommit={(v) => set({ from: v })} hint={tmarText("How far along the sketch plane's normal the surface starts")} />
          <Num label={tmarText("To")} testId="sheet-to" slot="to" value={d.to} nominal="length" onCommit={(v) => set({ to: v })} hint={tmarText("How far along the normal it ends — past the body on both sides, so the split goes right through")} />
          <p className="hint">{tmarText("Every drawn piece of the sketch, open or closed, becomes the surface. It is a body in the list, marked as a surface, and never exported on its own.")}</p>
        </>
      )
      break
    case 'split': {
      const sheets = bodies.filter((b) => b.id !== d.body)
      // A sheet split is trimmed: its pieces kept by the scan or by area,
      // and never what lies between — that is a solid's wall.
      const ofSheet = bodies.find((b) => b.id === d.body)?.surface === true
      const piece = ofSheet ? tmarText('piece') : tmarText('fragment')
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body, tools: d.tools.filter((t) => t !== body), ...(bodies.find((b) => b.id === body)?.surface && d.keep === 'between' ? { keep: 'scan' as SplitKeep } : {}) }))}
          <div className="field">
            <span>{tmarText("Cut with")}</span>
            <span className="picked" data-test="split-tools">
              {sheets.length === 0
                ? 'Make a sheet first'
                : sheets.map((b) => (
                    <label key={b.id} className="checkrow">
                      <input type="checkbox" data-test="split-tool" checked={d.tools.includes(b.id)} onChange={(e) => set({ tools: e.target.checked ? [...d.tools, b.id] : d.tools.filter((t) => t !== b.id) })} />
                      <span>{b.name}</span>
                    </label>
                  ))}
            </span>
          </div>
          <label className="field">
            <span>{tmarText("Keep")}</span>
            <select data-test="split-keep" value={d.keep} onChange={(e) => set({ keep: e.target.value as SplitKeep })}>
              <option value="scan">{tmarText("The ")}{piece}{tmarText("s on the scan")}</option>
              <option value="largest">{tmarText("The largest ")}{piece}{ofSheet ? tmarText(", by area") : ''}</option>
              <option value="smallest">{tmarText("The smallest ")}{piece}{ofSheet ? tmarText(", by area") : ''}</option>
              {!ofSheet && <option value="between">{tmarText("What lies between the sheets")}</option>}
            </select>
          </label>
          {ofSheet && <p className="hint">{tmarText("The sheet is trimmed: the pieces kept are sewn into one sheet, for Thicken. A fitted skin laid past the part's edge loses its overshoot on the scan.")}</p>}
          {d.keep === 'scan' && (
            <>
              <Num label={tmarText("Tolerance")} testId="split-tolerance" slot="tolerance" value={d.tolerance} nominal="length" onCommit={(v) => set({ tolerance: Math.abs(v) })} hint={tmarText("How far a sampled point of a fragment's face may lie from the scan and still count as on it — a few times the scan's scatter")} />
              <Num label={tmarText("Overlap")} unit="%" testId="split-overlap" slot="overlap" value={Math.round(d.overlap * 100)} onCommit={(v) => set({ overlap: Math.min(1, Math.max(0.05, Math.abs(v) / 100)) })} hint={tmarText("The share of a fragment's samples that must lie on the scan for it to be kept: a pocket's fragment has the pocket's roof where the scan has its floor, and falls out")} />
            </>
          )}
        </>
      )
      break
    }
    case 'loft':
      fields = (
        <>
          <div className="field">
            <span>{tmarText("Sketches")}</span>
            <span className="picked" data-test="loft-sketches">
              {sketches.map((s) => (
                <label key={s.id} className="checkrow">
                  <input type="checkbox" data-test="loft-sketch" checked={d.sketches.includes(s.id)} onChange={(e) => set({ sketches: e.target.checked ? [...d.sketches, s.id] : d.sketches.filter((t) => t !== s.id) })} />
                  <span>{s.name}</span>
                </label>
              ))}
            </span>
          </div>
          <label className="checkrow">
            <input type="checkbox" data-test="loft-ruled" checked={d.ruled} onChange={(e) => set({ ruled: e.target.checked })} />
            <span>{tmarText("Straight between the profiles")}</span>
          </label>
          <OpFields op={d.op} canCut={bodies.some((b) => !b.surface)} testPrefix="loft" onOp={(op) => set({ op })} />
          <p className="hint">{tmarText("In the order ticked, each sketch's one region — or its largest.")}</p>
        </>
      )
      break
    case 'thicken': {
      const sheets = bodies.filter((b) => b.surface)
      fields = (
        <>
          <label className="field">
            <span>{tmarText("Sheet")}</span>
            <select data-test="thicken-sheet" value={d.sheet ?? ''} onChange={(e) => set({ sheet: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{sheets.length === 0 ? tmarText("Make a sheet or fit a surface first") : tmarText("Select…")}</option>
              {sheets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Num label={tmarText("Thickness")} testId="thicken-thickness" slot="thickness" value={d.thickness} nominal="length" onCommit={(v) => set({ thickness: Math.abs(v) })} hint={tmarText("The wall, through the solid — every point of the sheet that far from the far skin")} />
          <label className="field">
            <span>{tmarText("Grows")}</span>
            <select data-test="thicken-side" value={d.side} onChange={(e) => set({ side: e.target.value as ThickenSide })}>
              <option value="in">{tmarText("Against the sheet's normal")}</option>
              <option value="out">{tmarText("Along the sheet's normal")}</option>
              <option value="both">{tmarText("Half each way")}</option>
            </select>
          </label>
          <OpFields op={d.op} canCut={bodies.some((b) => !b.surface)} testPrefix="thicken" onOp={(op) => set({ op })} />
          <p className="hint">{tmarText("A freeform thin shell's wall from its one skin — the sheet stays a body of its own, put out of view. A face that bends tighter than the thickness towards the side it grows to is named, and the thickness it takes.")}</p>
        </>
      )
      break
    }
    case 'sweep':
      fields = (
        <>
          <SweepFields profile={d.profile} path={d.path} route={d.route} sketches={sketches} onChange={set} />
          {d.route && <Num label={tmarText("Bend radius")} testId="sweep-bend-radius" slot="route.bendRadius" value={d.route.bendRadius} nominal="radius" onCommit={(v) => d.route && set({ route: { ...d.route, bendRadius: Math.abs(v) } })} hint={tmarText("On the centreline, for every bend without a radius of its own. A bend that does not fit its straights is refused, saying the most it takes.")} />}
          <OpFields op={d.op} canCut={bodies.some((b) => !b.surface)} testPrefix="sweep" onOp={(op) => set({ op })} />
        </>
      )
      break
    case 'pattern': {
      const options = [
        ...elements.filter((e) => e.fit && (e.fit.kind === 'line' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone' || e.fit.kind === 'circle')).map((e) => ({ key: `element:${e.id}`, label: e.name, ref: { kind: 'element', id: e.id } as AxisRef })),
        ...WORLD_AXES.map((axis) => ({ key: `world:${axis}`, label: tmarText("{0} axis", [axis.toUpperCase()]), ref: { kind: 'world', axis } as AxisRef })),
      ]
      const chosen = d.axis ? (d.axis.kind === 'element' ? `element:${d.axis.id}` : d.axis.kind === 'world' ? `world:${d.axis.axis}` : '') : ''
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <label className="field">
            <span>{tmarText("Kind")}</span>
            <select data-test="pattern-mode" value={d.mode} onChange={(e) => set({ mode: e.target.value as 'circular' | 'linear', step: e.target.value === 'circular' ? 360 : len.fromDisplay(len.step(10)) })}>
              <option value="circular">{tmarText("Circular, about an axis")}</option>
              <option value="linear">{tmarText("Linear, along a direction")}</option>
            </select>
          </label>
          <label className="field">
            <span>{d.mode === 'circular' ? tmarText("About") : tmarText("Along")}</span>
            <RefPicker
              value={chosen || null}
              options={options.map((o) => ({ key: o.key, label: o.label, group: o.key.startsWith('element:') ? 'Elements' : 'Coordinate axes' }))}
              placeholder={tmarText("Choose…")}
              testId="pattern-axis"
              onChange={(key) => set({ axis: options.find((o) => o.key === key)?.ref ?? null })}
              onHover={(key) => hintAxis(key, options, chosen)}
            />
          </label>
          <Num label={tmarText("Count")} unit="" testId="pattern-count" slot="count" value={d.count} onCommit={(v) => set({ count: Math.max(2, Math.round(Math.abs(v))) })} hint={tmarText("Copies in all, the body itself counted")} />
          {d.mode === 'circular' ? (
            <Num label={tmarText("Over")} unit="°" testId="pattern-step" slot="step" value={d.step} nominal="angle" onCommit={(v) => set({ step: Math.abs(v) })} hint={tmarText("The angle from the first copy to the last: 360° spreads them evenly round")} />
          ) : (
            <Num label={tmarText("Spacing")} testId="pattern-step" slot="step" value={d.step} nominal="length" onCommit={(v) => set({ step: Math.abs(v) })} hint={tmarText("The distance from one copy to the next")} />
          )}
          {d.mode === 'linear' && (
            <>
              <label className="field">
                <span>{tmarText("Then along")}</span>
                <RefPicker
                  value={d.axis2 ? (d.axis2.kind === 'element' ? `element:${d.axis2.id}` : d.axis2.kind === 'world' ? `world:${d.axis2.axis}` : null) : null}
                  options={options.map((o) => ({ key: o.key, label: o.label, group: o.key.startsWith('element:') ? 'Elements' : 'Coordinate axes' }))}
                  placeholder={tmarText("Nothing — one row")}
                  testId="pattern-axis2"
                  onChange={(key) => set({ axis2: options.find((o) => o.key === key)?.ref ?? null })}
                  onHover={(key) => hintAxis(key, options, chosen)}
                />
              </label>
              {d.axis2 && (
                <>
                  <button className="chip nominal" data-test="pattern-axis2-clear" title={tmarText("One row only — no second direction")} onClick={() => set({ axis2: null })}>{tmarText("× one row")}</button>
                  <Num label={tmarText("Rows")} unit="" testId="pattern-count2" slot="count2" value={d.count2} onCommit={(v) => set({ count2: Math.max(1, Math.round(Math.abs(v))) })} hint={tmarText("Rows along the second direction, the first counted — a grid")} />
                  <Num label={tmarText("Row spacing")} testId="pattern-step2" slot="step2" value={d.step2} nominal="length" onCommit={(v) => set({ step2: Math.abs(v) })} hint={tmarText("The distance from one row to the next")} />
                </>
              )}
            </>
          )}
        </>
      )
      break
    }
    case 'import':
      fields = (
        <>
          <div className="field">
            <span>{tmarText("File")}</span>
            <span className="picked" data-test="import-file">
              {d.file ? tmarText("{0} · {1}", [d.file.name, fileSize(d.file.size)]) : tmarText("No file chosen")}
            </span>
          </div>
          <div className="toolrow">
            <StepFileKey testId="import-choose" title={tmarText("Read another STEP file in this one's place — the features after it keep their picks where they still find them")} onFile={(file) => set({ file })}>
              {d.file ? tmarText("Another file…") : tmarText("Choose a STEP file…")}
            </StepFileKey>
          </div>
          <p className="hint" data-test="import-about">{tmarText("A body for every solid in the file, in the frame the file was drawn in, named as the file names its parts. Put them in place with ")}<b>{tmarText("Move body")}</b>.
          </p>
        </>
      )
      break
    case 'moveBody': {
      const picked = d.bodies.map((id) => bodies.find((b) => b.id === id)?.name ?? features.find((f) => f.id === id)?.name ?? `body ${id}`)
      const others = bodies.filter((b) => !d.bodies.includes(b.id))
      const axis = (key: 'translate' | 'rotate', i: number, v: number) => {
        const next = [...d[key]] as Vec3
        next[i] = v
        set({ [key]: next })
      }
      fields = (
        <>
          <div className="field">
            <span>{d.bodies.length === 1 ? tmarText("Body") : tmarText("Bodies")}</span>
            <span className="picked" data-test="move-body-bodies">
              {d.bodies.length === 0 ? tmarText("Click the bodies to move on the part, or their rows in the body list") : picked.join(', ')}
              {d.bodies.length > 0 && <ClearPicks kind="move-body" />}
            </span>
          </div>
          {others.length > 0 && (
            <label className="field">
              <span>{tmarText("Add")}</span>
              <select data-test="move-body-add" value="" onChange={(e) => e.target.value !== '' && re.getState().setMoveBodies([...d.bodies, Number(e.target.value)])}>
                <option value="">{d.bodies.length === 0 ? tmarText("Or choose a body…") : tmarText("Another body…")}</option>
                {others.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="checkrow" title={tmarText("Leave the bodies where they are and move copies of them — bodies of their own")}>
            <input type="checkbox" data-test="move-body-copy" checked={d.copy} onChange={(e) => set({ copy: e.target.checked })} />
            <span>{tmarText("Copy — move a copy, the body stays where it is")}</span>
          </label>
          <XyzField label={tmarText("Move")} kind="length" slot="translate" value={d.translate} testId="move-body-translate" hint={tmarText("How far along the part's X, Y and Z, after the turn — the arrows on the part drag them")} onCommit={(i, v) => axis('translate', i, v)} />
          <XyzField label={tmarText("Turn")} unit="°" kind="angle" slot="rotate" value={d.rotate} testId="move-body-rotate" hint={tmarText("Degrees about X, then about Y, then about Z, each through the middle of the bodies as they were picked — the rings on the part drag them; each ring stands about the axis its angle turns about")} onCommit={(i, v) => axis('rotate', i, v)} />
          <div className="toolrow">
            <button data-test="move-body-reset" disabled={d.translate.every((v) => v === 0) && d.rotate.every((v) => v === 0)} title={tmarText("Put the bodies back where they stood: every distance and angle zero")} onClick={() => set({ translate: [0, 0, 0], rotate: [0, 0, 0], exprs: undefined })}>{tmarText("Reset")}</button>
          </div>
          <p className="hint" data-test="move-body-pivot">{tmarText("Turned about ")}{d.pivot.map((v) => lenBare(v, len.units, 2)).join(', ')}{tmarText(" — the middle of the ")}{d.bodies.length === 1 ? tmarText("body") : tmarText("bodies")}{tmarText(" as picked.")}</p>
        </>
      )
      break
    }
    case 'offsetBody':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <Num label={tmarText("Distance")} testId="offset-body-distance" slot="distance" value={d.distance} nominal="length" onCommit={(v) => set({ distance: v })} hint={tmarText("How far all round — out, or in with a negative one. The convex edges come out rounded, as an offset rounds them")} />
          <label className="checkrow" title={tmarText("Leave the body as it is and make the offset a body of its own — a keep-out round a part, or what is cut from a case to hold it with clearance (Combine, Cut by, the offset as the tool)")}>
            <input type="checkbox" data-test="offset-body-keep" checked={d.keep} onChange={(e) => set({ keep: e.target.checked })} />
            <span>{tmarText("Keep the body — the offset a new one")}</span>
          </label>
          <p className="hint">{d.keep ? tmarText("Cut it from a case with Combine to leave a pocket with the clearance.") : tmarText("The body becomes the offset.")}</p>
        </>
      )
      break
    case 'boolean':
      fields = (
        <>
          {bodySelect(d.body, (body) => set({ body }))}
          <label className="field">
            <span>{tmarText("Operation")}</span>
            <select data-test="boolean-op" value={d.op} onChange={(e) => set({ op: e.target.value as 'join' | 'cut' | 'intersect' })}>
              <option value="join">{tmarText("Join")}</option>
              <option value="cut">{tmarText("Cut by")}</option>
              <option value="intersect">{tmarText("Intersect with")}</option>
            </select>
          </label>
          {bodySelect(d.tool, (tool) => set({ tool, moreTools: (d.moreTools ?? []).filter((t) => t !== tool) }), 'Tool', 'boolean-tool')}
          {/* More tools: joined all, or cut or intersected by in turn. */}
          {d.tool !== null && (
            <div className="field">
              <span>{tmarText("More tools")}</span>
              <span className="picked" data-test="boolean-more-tools">
                {(d.moreTools ?? []).map((id) => (
                  <label key={id} className="checkrow">
                    <input type="checkbox" data-test="boolean-more-tool" checked onChange={() => set({ moreTools: (d.moreTools ?? []).filter((t) => t !== id) })} />
                    <span>{bodies.find((b) => b.id === id)?.name ?? (tmarText("Body {0}", [id]))}</span>
                  </label>
                ))}
                <select data-test="boolean-add-tool" value="" onChange={(e) => e.target.value !== '' && set({ moreTools: [...(d.moreTools ?? []), Number(e.target.value)] })}>
                  <option value="">{tmarText("Add a tool…")}</option>
                  {bodies
                    .filter((b) => b.id !== d.body && b.id !== d.tool && !(d.moreTools ?? []).includes(b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </span>
            </div>
          )}
          <label className="checkrow" title={tmarText("Keep the tool as a body of its own after the combine, as it was — the body is joined, cut or intersected with a copy of it")}>
            <input type="checkbox" data-test="boolean-keep" checked={d.keep} onChange={(e) => set({ keep: e.target.checked })} />
            <span>{tmarText("Keep the tool body")}</span>
          </label>
          <p className="hint">{d.keep || (bodies.find((b) => b.id === d.body)?.surface && d.op !== 'join') ? tmarText("The tool body stays as it is, beside the result.") : tmarText("The tool body goes into the result.")}</p>
          {bodies.find((b) => b.id === d.body)?.surface && (
            <p className="hint" data-test="boolean-sheet">
              {d.op === 'join' ? tmarText("A sheet joins a sheet: the two are sewn into one where they meet edge to edge — split each by the other first.") : tmarText("The sheet is trimmed to the part of it {0} the solid tool, and stays a sheet for Thicken; the tool stays a body, to trim another sheet with.", [d.op === 'intersect' ? tmarText("inside") : tmarText("outside")])}
            </p>
          )}
        </>
      )
      break
    case 'surface': {
      // What a plane or a cylinder can be held to: the part's planes, the
      // measured elements, and the planes and cylinders fitted before this
      // one in the list — every one of them, for a surface that is new.
      const at = d.featureId === undefined ? features.length : features.findIndex((f) => f.id === d.featureId)
      const holds: { key: string; name: string; kind: 'plane' | 'axis' }[] = [
        ...constrainRefs(elements).map((r) => ({ key: r.key, name: r.name, kind: r.kind })),
        ...features.slice(0, at < 0 ? features.length : at).flatMap((f) => (f.kind === 'surface' && (f.shape ?? 'freeform') !== 'freeform' ? [{ key: `surface:${f.id}`, name: f.name, kind: f.shape === 'plane' ? ('plane' as const) : ('axis' as const) }] : [])),
      ]
      const holdValue = d.constrain.mode === 'force' ? `${d.constrain.relation}|${d.constrain.ref}` : d.constrain.mode
      fields = (
        <>
          <label className="field">
            <span>{tmarText("Shape")}<InfoDot title={tmarText("What is fitted")}>
                <p>
                  <b>{tmarText("Freeform")}</b>{tmarText(" is a smooth B-spline surface through the region — a blend, a crowned lid.")}{' '}
                  <b>{tmarText("Plane")}</b>{tmarText(" and ")}<b>{tmarText("Cylinder")}</b>{tmarText(" are the exact faces a designed part is made of, and they are held to what the part already has: a fit that lands within ")}{TILT_TOLERANCE_DEG}{tmarText("° of parallel or square to a coordinate plane, a measured element or a surface fitted before it is fitted again with that held, and within ")}{mm(COINCIDENCE_MM)}{tmarText(" of a parallel plane or axis it is put on it. A trim cuts with the whole plane or cylinder, not only the patch drawn.")}</p>
              </InfoDot>
            </span>
            <select data-test="surface-shape" value={d.shape} onChange={(e) => set({ shape: e.target.value as SurfaceShape, constrain: { mode: 'auto' } })}>
              <option value="freeform">{tmarText("Freeform")}</option>
              <option value="plane">{tmarText("Plane")}</option>
              <option value="cylinder">{tmarText("Cylinder")}</option>
            </select>
          </label>
          {d.shape !== 'freeform' && (
            <label className="field">
              <span>{tmarText("Hold to")}</span>
              <select
                data-test="surface-constrain"
                value={holdValue}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'auto' || v === 'free') set({ constrain: { mode: v } })
                  else set({ constrain: { mode: 'force', relation: v.slice(0, v.indexOf('|')) as Relation, ref: v.slice(v.indexOf('|') + 1) } })
                }}
              >
                <option value="auto">{tmarText("Auto — what it lands near")}</option>
                <option value="free">{tmarText("Nothing — the free fit")}</option>
                {holds.map((h) =>
                  relationsFor(d.shape === 'plane' ? 'plane' : 'cylinder', h.kind).map((relation) => (
                    <option key={`${relation}|${h.key}`} value={`${relation}|${h.key}`}>
                      {tmarText(relationWords(d.shape === 'plane' ? 'plane' : 'cylinder', relation, h.kind))} {h.name}
                    </option>
                  )),
                )}
              </select>
            </label>
          )}
          <div className="field">
            <span>{tmarText("Region")}<InfoDot title={tmarText("The region")}>
                <p>{tmarText("The patch of the scan the surface is fitted through. ")}<b>{tmarText("Click the scan")}</b>{tmarText(" to add the face under the click — a flood from there over every edge whose normals turn by less than the angle, one flat face of a CAD-like part at 1°, a patch of a scan up to its first crease; Ctrl-click takes a flood away. Or mark it with the tools — brush, window, lasso — like a surface in 3D Measure. The region is the surface's own: it takes nothing from a 3D Measure element and may overlap a neighbour's at a seam.")}</p>
              </InfoDot>
            </span>
            <span className="unitfield">
              <b data-test="surface-region" style={{ fontSize: 12 }}>
                {d.region.length === 0 ? tmarText("None — click the scan") : tmarText("{0} points", [d.region.length.toLocaleString('en-US')])}
              </b>
              <button data-test="surface-region-clear" disabled={d.region.length === 0} title={tmarText("Start the region over")} onClick={() => re.getState().setRegion(new Uint32Array(0))}>{tmarText("Clear")}</button>
            </span>
          </div>
          <Num label={tmarText("Flood angle")} unit="°" testId="surface-flood" value={d.floodDeg} onCommit={(v) => set({ floodDeg: Math.min(89, Math.max(0.1, Math.abs(v))) })} hint={tmarText("How far the normals may turn over one edge for a click's flood to cross it")} />
          <label className="checkrow">
            <input type="checkbox" data-test="surface-paint" checked={d.paint} onChange={(e) => set({ paint: e.target.checked })} />
            <span>{tmarText("Mark with the tools")}</span>
          </label>
          {d.paint && <MarkTools escapeNote="Esc puts the tools away" showCount={false} onClear={() => re.getState().setRegion(new Uint32Array(0))} />}
          {d.shape === 'freeform' && (
          <label className="checkrow">
            <input type="checkbox" data-test="surface-auto-net" checked={d.fit.net === null} onChange={(e) => set({ fit: { ...d.fit, net: e.target.checked ? null : { u: preview.status === 'ok' && preview.surface ? preview.surface.net.u : 5, v: preview.status === 'ok' && preview.surface ? preview.surface.net.v : 5 } } })} />
            <span>{tmarText("Net sized from the region")}</span>
          </label>
          )}
          {d.shape === 'freeform' && d.fit.net && (
            <>
              <Num label={tmarText("Net U")} unit="" testId="surface-net-u" value={d.fit.net.u} onCommit={(v) => set({ fit: { ...d.fit, net: { u: Math.round(Math.abs(v)), v: d.fit.net!.v } } })} hint={tmarText("Control points across the region's long side, 3 to 20")} />
              <Num label={tmarText("Net V")} unit="" testId="surface-net-v" value={d.fit.net.v} onCommit={(v) => set({ fit: { ...d.fit, net: { u: d.fit.net!.u, v: Math.round(Math.abs(v)) } } })} hint={tmarText("Control points across the short side, 3 to 20")} />
            </>
          )}
          <Num label={tmarText("Expand by")} unit="%" testId="surface-expand" value={d.fit.expandPct} onCommit={(v) => set({ fit: { ...d.fit, expandPct: Math.min(200, Math.max(0, Math.abs(v))) } })} hint={tmarText("How far past the region the surface reaches, as a share of its extent — it has to meet its neighbours for the trim")} />
          {d.shape === 'freeform' && <Num label={tmarText("Smoothness")} unit="" testId="surface-smooth" value={d.fit.smoothness} onCommit={(v) => set({ fit: { ...d.fit, smoothness: Math.max(0, Math.abs(v)) } })} hint={tmarText("How hard the surface is held fair against the points: 0 follows them exactly, 0.01 fairs a scan's noise, more flattens detail")} />}
        </>
      )
      break
    }
    case 'network':
      fields = <NetworkFields d={d} />
      break
    case 'trim': {
      const has = (t: TrimTool) => d.tools.some((x) => x.kind === t.kind && x.id === t.id)
      const toggle = (t: TrimTool) => {
        const tools = has(t) ? d.tools.filter((x) => !(x.kind === t.kind && x.id === t.id)) : [...d.tools, t]
        set({ tools, ...(d.toleranceTyped ? {} : { tolerance: trimToleranceFor(tools, results) }) })
      }
      const surfaces = bodies.filter((b) => b.id !== d.featureId)
      const solids = elements.filter((e) => e.fit && (e.fit.kind === 'plane' || e.fit.kind === 'cylinder' || e.fit.kind === 'cone' || e.fit.kind === 'sphere' || e.fit.kind === 'torus'))
      fields = (
        <>
          <div className="field">
            <span>{tmarText("Surfaces")}<InfoDot title={tmarText("The surfaces")}>
                <p>{tmarText("The set that closes into the solid: fitted surfaces and sheets from this workspace, and measured planes, cylinders, cones and spheres from 3D Measure, each reaching past the part. A box round the scan is cut by all of them, and of the faces that makes, the ones lying on the scan — within the tolerance, over the overlap share of their samples — are kept and sewn. A solid body's faces count too.")}</p>
                <p>{tmarText("A set that does not close leaves a surface body of the kept faces with its open edges drawn red on the part: fit the surface missing there and edit the trim to take it in.")}</p>
              </InfoDot>
            </span>
            <b data-test="trim-count" style={{ fontSize: 12 }}>
              {d.tools.length}{tmarText(" of ")}{surfaces.length + solids.length}
            </b>
          </div>
          <div className="checklist" data-test="trim-tools">
            {surfaces.map((b) => (
              <label key={`b${b.id}`} className="checkrow">
                <input type="checkbox" data-test={`trim-tool-body-${b.id}`} checked={has({ kind: 'body', id: b.id })} onChange={() => toggle({ kind: 'body', id: b.id })} />
                <span>
                  {b.name}
                  {results[b.id]?.surface ? tmarText(" · σ {0}", [len.fmt(results[b.id]!.surface!.rms, 3)]) : b.surface ? '' : tmarText(" · solid")}
                </span>
              </label>
            ))}
            {solids.map((e) => (
              <label key={`e${e.id}`} className="checkrow">
                <input type="checkbox" data-test={`trim-tool-element-${e.id}`} checked={has({ kind: 'element', id: e.id })} onChange={() => toggle({ kind: 'element', id: e.id })} />
                <span>
                  {e.name} · {tmarText(e.fit!.kind)}
                </span>
              </label>
            ))}
            {surfaces.length + solids.length === 0 && <p className="hint">{tmarText("No surface to close yet — fit surfaces here, or planes and cylinders in 3D Measure.")}</p>}
          </div>
          <Num label={tmarText("Tolerance")} testId="trim-tolerance" slot="tolerance" value={d.tolerance} onCommit={(v) => set({ tolerance: Math.abs(v), toleranceTyped: true })} hint={tmarText("How far a face's sampled point may lie from the scan and still count as on it — three times the scan's scatter, read off the surfaces' own fits")} />
          <p className="hint" data-test="trim-tolerance-source">
            {d.toleranceTyped ? tmarText("Tolerance as typed.") : d.tools.some((t) => t.kind === 'body' && results[t.id]?.surface) ? tmarText("Three times the median σ of the fitted surfaces in the set.") : tmarText("No fitted surface in the set — {0} to start.", [mm(DEFAULT_SPLIT_TOLERANCE_MM)])}
          </p>
          <Num label={tmarText("Overlap")} unit="%" testId="trim-overlap" slot="overlap" value={Math.round(d.overlap * 100)} onCommit={(v) => set({ overlap: Math.min(1, Math.max(0.05, Math.abs(v) / 100)) })} hint={tmarText("The share of a face's samples that must lie on the scan for the face to be kept")} />
        </>
      )
      break
    }
  }
  const bodyNamed = 'body' in d && d.body !== null ? (bodies.find((b) => b.id === d.body)?.name ?? features.find((f) => f.id === d.body)?.name) : null
  return (
    <div className="draftbox" data-test={`${testKind}-editor`}>
      <div className="sec-head">{d.featureId !== undefined ? tmarText("Edit {0}", [d.name ?? tmarText(title[d.kind])]) : d.kind === 'import' || d.kind === 'moveBody' ? tmarText(title[d.kind]) : tmarText("New {0}", [tmarText(title[d.kind]).toLowerCase()])}</div>
      {d.featureId !== undefined && <NameField value={d.name ?? ''} testId={`${testKind}-name`} onChange={(name) => set({ name })} />}
      <BuildSays featureId={d.featureId} />
      {fields}
      {!planned && !leaning && <PreviewLine preview={ready ? preview : { status: 'idle' }} testPrefix={testKind} />}
      {!planned && !leaning && <AnalysisRow testPrefix={testKind} />}
      <button className="primary block" data-test={`${testKind}-create`} disabled={!ready || (d.kind === 'network' && (d.motionActive || preview.status !== 'ok'))} title={tmarText("Enter does the same")} onClick={() => re.getState().commitFeature()}>
        {d.featureId !== undefined ? tmarText("Save changes") : planned ? d.kind === 'moveFace' && d.faces.length > 1 ? tmarText("Move the faces") : tmarText("Move the face") : d.kind === 'import' ? tmarText("Import") : d.kind === 'moveBody' ? tmarText("{0} the {1}", [d.copy ? tmarText("Copy") : tmarText("Move"), d.bodies.length > 1 ? tmarText("bodies") : tmarText("body")]) : d.kind === 'deleteFace' ? tmarText("Delete the {0}{1}", [d.faces.length === 1 ? tmarText("face") : tmarText("faces"), bodyNamed ? tmarText(" of {0}", [bodyNamed]) : '']) : tmarText("Create {0}{1}", [title[d.kind].toLowerCase(), bodyNamed ? tmarText(" on {0}", [bodyNamed]) : ''])}
      </button>
      <div className="toolrow">
        <button data-test={`${testKind}-cancel`} onClick={() => re.getState().cancelFeature()}>{tmarText("Cancel")}</button>
      </div>
    </div>
  )
}
