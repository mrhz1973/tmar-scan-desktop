<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Edit Surface in the shared workspace — integration checkpoint

The adapter is owned entirely by `plugins/tmar-edit-surface/**`. It uses the
optional ScanRuler workspace-editor host at commit
`a28c747591e740d62f3b1f90330f145141c77de1`; when that host module is absent,
the existing standalone editor remains the entry point. The host is supplied
separately by its owner. This checkpoint is not a release or a claim of
complete QuickSurface parity.

The shared-view session owns its worker and draft, not the app's camera, canvas,
source geometry or model history. It previews a selected CAD face in part-frame
millimetres. A host ticket freezes an exactly validated draft before exporting
an independent STEP copy. The host stages and publishes that copy atomically.
An armed note or an in-flight note pick blocks Apply. The original `cad-copy`
contract also blocks Apply while draft notes exist. With the separate optional
`annotated-cad-copy` V1 capability, the session freezes all notes and prepares
them together with the final STEP and a face witness; it does not itself write
host state. A host without this capability keeps the original behavior.

## Evidence on 2026-11-03

- Actual host TypeScript check: PASS. After the direct D update the session
  and shared-layer suites passed 36 and 33 tests respectively. These do not alone establish
  app-level behavior.
- Isolated source application, synthetic STEP box: same main canvas, camera and
  camera pose on entry; selected face, normal numeric move, local Undo/Redo,
  captured pointer drag, and Apply as one new history action. The original and
  copy reimported as valid six-face solids, with different volumes. The editor
  dock fitted at the tested 1440-pixel window width without horizontal overflow.
- Isolated source application, owner's Lego STEP: a supported planar face was
  converted exactly to NURBS for editing; numeric normal movement and actual
  pointer drag were applied as a copy. OCCT reimported both original and copy
  as valid 51-face solids. The source file's SHA-256 was unchanged. Face order
  changed when the host serialized the body, so the selected face index is a
  session index, not a durable identity.
- A separate synthetic STEP already containing a B-spline face was imported;
  that face was selected without plane conversion or enrichment, a free pole
  moved 0.05 mm along the normal, and Apply created a valid six-face solid copy
  (`existing-nurbs-ACzJr2`). The original STEP hash and reimported B-rep were
  unchanged. The owner's Lego STEP has no pre-existing B-spline faces, so it
  does not establish this specific capability. Other NURBS topologies remain
  unqualified.
- On a synthetic rational B-spline solid, the shared-view G1 workflow moved an
  interior pole and applied a valid copy (`workspace-g1-j9Cs5o`). At 68 sampled
  boundary positions the maximum displacement was 3.17e-13 mm; the minimum
  dot product of source and result normals was 0.9999999999999998. This compares
  the edited face to its own original boundary, not all adjacent faces or the
  entire continuous boundary. G1 protects existing conditions; it does not create
  tangency that was absent in the source.
- On the synthetic box, real Zebra overlays and the editable note panel were
  active together. A note anchor was supplied to the real CAD worker, the text
  and pin survived another deformation, and a plain Apply was blocked until
  the draft note was removed. A separate synthetic UI case selected a face and
  placed a note by clicking in the shared view; Cancel preserved the body,
  source render geometry, project build and history. That browser run used the
  original host and did not test persistent annotated Apply.
- On a synthetic box STEP, an in-process session using the real OCCT kernel
  selected a reversed face, enabled Zebra state, placed a note and deformed the
  face. Final preparation produced a valid one-solid STEP, the face witness and
  the note with consistent hashes, UV, position and outward-oriented normal.
  Separate checks cover all six box faces and a curved torus. These are kernel
  and session checks, not browser rendering or host Save/Load qualification.
- The updated controller was also exercised in the isolated source app with the
  original host (`run-EBOzsj`): Zebra and note editing worked together, the
  note was re-resolved after a surface move, and an unannotated Apply remained
  blocked until the note was removed. A subsequent ordinary Apply made one valid
  CAD copy and one history action. This did not test annotated persistence.
- An isolated experimental host snapshot, based on `27c75c3` and its verified
  uncommitted V1 runtime, was tested with plugin `130d12b` and a QA-only fix for
  the host's double reversal of face normals. On a synthetic box STEP the real
  controller deformed a reversed face with Zebra and a note active. Apply,
  Undo, Redo, native Save/Load and verification of the reopened CAD, note UUID,
  face binding, outward normal and source visibility passed (`annotated-edit-CwugH8`,
  14 checks). The positive and negative normal cases were also tested in the
  real kernel. The first run checked before asynchronous note revalidation;
  the successful run explicitly waited for it; the versioned test repeated
  the same scenario successfully (`annotated-edit-T0KZUH`). A subsequent run
  waited specifically for the receipt's note UUID, feature and copy body at
  each verification (`annotated-edit-sdytYJ`). This is source-app evidence,
  not qualification of a published host or packaged desktop release.
- An isolated compiled web build of that experimental host reopened and
  resaved the `sdytYJ` synthetic project through its public UI: seven checks
  passed for the note, UUID, face binding, normal, visibility and independent
  STEP reimport of both valid solids (`compiled-reopen-sdyt-20261104`). This
  does not test creation of the annotation in the compiled UI or a desktop EXE.
- Separate isolated source-app snap cases used a synthetic scan and a second
  synthetic CAD body. In both, the pole snapped from Z=10 to Z=12 mm; Alt and
  disabling snapping left the same approximately Z=11.5 mm free movement.
  The test checked source feedback, the borrowed geometry and one canvas. CAD
  targets were displayed tessellations. No large-scan timing was measured.
- Additional pointer-drag runs passed for Local N (`snap-DyusMR`) and Screen
  (`snap-mqAy49`) against both synthetic references. In each run snapping
  reached the target, while Alt and snap-off preserved free movement; the
  Screen drag stayed in the camera plane. These checks cover one planar top
  face and do not establish the intended behavior for occluded targets.
- The default pole drag is now Local N. If the chosen direction points almost
  at the camera, vertical pointer motion moves the pole in depth using the
  captured view scale. The fallback applies to poles only; free-edge D keeps
  its existing guard. An isolated shared-view synthetic STEP run exercised the
  actual pointer, Undo and Apply and reimported both valid solids (`run-Diu6zn`,
  15 checks). A further run (`run-FxHIzy`, 16 checks) also verified that the
  displayed CAD preview changes while the pointer is still held. Separate scan
  and CAD snap cases (`snap-cFcjZt`) each reached a
  +2 mm synthetic reference, while Alt and snap-off produced the same free
  +1.5 mm movement; each reported nine checks and no app console errors.
  Unit tests cover orthographic and perspective cameras, a rotated part and a
  near-aligned axis; the mapping near the alignment threshold is an interaction
  approximation. Neither run qualifies a packaged desktop app or other topology.
- Imported STEP bodies may contain extrusion or revolution supports alongside
  an editable face. The BREP table reader now recognizes their embedded curve
  record boundaries without modifying or enabling those supports. Independent
  synthetic OCCT fixtures exercised a plane edit on each body, checked the
  unchanged adjacent support record and reopened a valid solid. The extrusion
  case also passed the isolated shared-view numeric move, pointer drag,
  Undo/Redo and Apply workflow (`run-OASliT`), with both STEP bodies valid and
  the input hash unchanged. This is not direct editing of those curved faces.
- A separate, synthetic cylinder conversion spike is research only: the
  sampled support and 3D boundaries coincided, but the kernel's volume changed
  and the original BREP was invalid until healing. Signed mesh volumes at three
  finer resolutions moved toward the analytic reference. Healing raised the
  circular edge and vertex tolerance from `1e-7` to about `0.156576 mm`.
  The lateral pcurves remained linear in the circular edge parameter; at 257
  samples per circular edge the curve/surface discrepancy reached about
  `0.160357 mm`, versus zero on the source. This is a sampled discrepancy, not
  a global maximum; the tolerance is a permitted bound, not measured motion.
  The seam and all face/pcurve combinations still need verification. The public source of
  `occt-wasm` v5.7.1 shows that `getVolume` uses the default OCCT overload:
  https://github.com/andymai/occt-wasm/blob/v5.7.1/facade/generated/kernel.cpp
  The OCCT report https://github.com/Open-Cascade-SAS/OCCT/issues/1675 concerns
  primarily the Eps overload, so its defect cannot be attributed to this call.
  The spike remains outside production and cylinder editing is not enabled.
  A separate supported planar-cap edit on a synthetic cylinder preserved the
  original edge and vertex tolerances at `1e-7 mm` in its STEP round trip.
  A further isolated experiment rebuilt the converted cylinder face with
  `fixWireOnFace` (requested tolerance `1e-7 mm`), then sewed it to the two
  planar caps. Although the resulting single solid and face reported valid,
  edge and vertex tolerances still reached `0.156576 mm` and its reported
  volume remained `6296.4133 mm³` versus `6283.1853 mm³` on the source. This
  wire-repair approach therefore does not qualify cylindrical editing; the
  diagnostic used one synthetic cylinder and did not assert a global bound.
  A different isolated experiment used the existing OCCT general transform
  with an identity matrix. On that cylinder it yielded a valid periodic-U
  B-spline solid with `1e-7 mm` edge/vertex tolerances and a sampled surface
  gap below `4e-14 mm`. Its reported OCCT volume was `6337.3174 mm³` rather
  than the source `6283.1853 mm³`; independently sampled signed triangle
  volumes converged to `6283.1664` and `6283.1644 mm³` respectively at the
  finest tested deflection, without proving the source of the discrepancy.
  `periodic-conversion.test.ts` also compares the source, converted body and
  reopened STEP on this fixture: matching subshape counts and face
  orientations, and sampled edge locations, surface positions and normals.
  Edge comparison uses nearest locations; it does not inspect either seam
  pcurve or prove same-parameter correspondence.
  The periodic record can now be read and round-tripped without enabling
  editing. Exact V elevation/refinement exposed an interior row; on this
  one synthetic solid an interior pole move preserved sampled caps/seam,
  edge tolerances and a valid STEP round trip. A different pole changed the
  seam tangent despite preserving its sampled position. This is not a UI
  capability. On that cylinder in two positions/orientations,
  `periodic-seam.test.ts` compares both serialized seam pcurves to their 3D
  edge and tests the two seam normals at 65 samples before editing, after
  one interior pole move, and after STEP reopening. This does not qualify
  arbitrary seam/trim pcurves, controls,
  recipes or other STEP topologies. Periodic editing is explicitly rejected.
  Subsequent checks found that moving one interior pole alone can introduce a
  tangent break at a different double knot even when the seam and caps pass.
  A restricted experimental move couples neighbouring poles using their
  weights; X/Y/Z tests on the synthetic cylinder check the existing knot
  tangents and sampled one-sided derivative jumps. A cyclic local frame for
  the same six-pole periodic convention is checked against OCCT on straight
  and rotated fixtures, and refuses an ambiguous tangent at a crease. This
  is not yet wired to the editor or a general G1 solver.
  A synthetic nonseparable-weight counterexample changed the sampled
  derivative jump by about `0.0115`; the restricted helper now refuses nets
  whose weights vary along V within a U row. This is a guard for the tested
  full-cylinder convention, not support for general rational periodic nets.
  A separate gesture canonicalizer computes the coupled proposal from the
  captured starting frame and a validator rejects unexpected pole, weight or
  knot edits. These helpers are not yet connected to the worker or UI; the
  source-face/topology qualification and history/recipe integration remain.
  `cylinderSource.ts` adds a preliminary source-topology gate, tested on a
  synthetic STEP cylinder in two positions, a cut cylinder, and a box. It
  checks a single solid, caps, shared borders and a sampled UV interior; it
  does not prove the absence of every possible trim or validate both seam
  pcurves, conversion, volume, recipes or arbitrary imported STEP geometry.
  This preliminary helper is not connected to the editor and enables no
  additional surface editing.
  `cylinderSeam.ts` separately compares both serialized quadratic seam
  pcurves with a 3D edge at 65 samples. Synthetic straight and rotated STEP
  fixtures pass after conversion, deformation and STEP reopening; deliberately
  duplicated or shifted 2D representations are rejected. A candidate edge now
  must itself contain the same serialized support and two pcurves as the face;
  inconsistent records are rejected before geometric sampling. Matching still
  does not prove topological identity, so coincident edges may remain ambiguous.
  Equivalent but differently serialized curves can be rejected. Sampling is not
  a global proof; other BREP encodings fail closed. It is a diagnostic only,
  not a production gate.
  `cylinderPreparation.ts` combines the source screen, native identity
  conversion, sampled face/border comparisons in both directions, seam audit
  and exact V refinement. Tests retain the source unchanged and reimport one
  coupled-pole edit as a valid STEP for straight and rotated synthetic bodies;
  a cut cylinder is refused. Face correspondence uses returned OCCT ordering,
  and sampling does not prove equality everywhere. The function returns both
  kernel volume readings without declaring either transformed reading accurate;
  the known volume discrepancy, exact seam identity, recipe/history and real
  STEP qualification remain unresolved. It is not wired to the editor or UI.
  `cylinderEvaluation.ts` evaluates a coupled-pole proposal in isolation,
  verifies its face/support association, sampled protected boundaries,
  section intersections and matched boundary tolerances, and returns an
  exported STEP and display mesh without reporting the disputed volume.
  Straight and rotated synthetic cylinders reimported as valid and showed a
  measurable interior change; wrong faces, changed protected points and a
  large deformation were refused. This remains unconnected to the worker/UI;
  sampled checks do not prove global self-intersection freedom or establish
  arbitrary STEP support. The underlying volume discrepancy remains unresolved.
  `cylinderDraft.ts` reuses the local surface history in an isolated experiment:
  it validates a move before recording it, preserves locked points and supports
  Undo/Redo. The synthetic STEP test also checks rejected edits, source and
  snapshot isolation, and skips tessellation for a lock-only Undo. It is not
  connected to the UI/worker, and per-move evaluation remains too slow for a
  demonstrated real-time drag; no interactive performance claim is made.
  Preparation also rejects any increase in the sorted edge/vertex tolerance
  distributions between source, conversion and refinement. This is a coarse
  guard, not per-edge TShape matching. The synthetic tests include increased
  and missing tolerances; they do not qualify tolerances after arbitrary edits.
  A second guard pairs individual edges by bidirectional geometric samples and
  vertices by position, rejecting ambiguous matches and increased tolerances.
  A synthetic test detects a per-edge increase even when sorted distributions
  are unchanged. This sampled pairing is not exact topological naming and has
  not been qualified for arbitrary STEP bodies or after arbitrary edits.
  Net edge/cell picking and cage drawing now include cyclic connections for
  periodic dimensions with more than two rows. Ambiguous two-row periodic
  picking and unqualified periodic frame conventions fail closed; periodic
  local drag is not yet available in the editor. `periodic-picking.test.ts` and existing
  picking/cage/local-frame checks pass on synthetic fixtures.
- A synthetic STEP box in the isolated shared view passed pointer selection of
  a second CAD face, preservation of a modified draft when the change was
  cancelled, and a confirmed change (`run-jx0E4G`). Failed face loading also
  preserves the draft and its Undo history in session tests. An in-progress CAD
  evaluation must finish before changing faces; draft notes still block a change.
- After the face-switch change, the annotated source-app scenario passed its 14
  checks again (`annotated-edit-LYQ8lX`): Zebra, note, deformation, Apply,
  Undo/Redo, native Save and reopen. The 34 plugin runtime files in that QA copy
  matched the author checkout after newline normalization. The host was the
  corrected experimental snapshot, not a checkout of the published host SHA.
- The host owner integrated host `5684f5f` and the exact plugin `324a2e0` in
  draft PR https://github.com/mrhz1973/tmar-scan-desktop/pull/23, runtime
  commit `5f39ff5`. The reported independent checks include 155 focused tests,
  TypeScript and production build, 15 source-app face-switch checks, and 16
  compiled-browser checks from fresh synthetic STEP through Zebra, note,
  deformation, Apply, Undo/Redo, Save/Load and STEP export. Both exported
  solids reimported as valid. The compiled test used a forward face; reversed
  normals have separate kernel tests, not the same compiled UI scenario.
  This remains draft integration, not a packaged desktop release.
- An isolated box test in the shared view selected a control pole, enabled
  symmetry, moved the reflected pair, checked preview-only transparency and
  Undo, then applied a valid modified solid copy (`run-n8jr0q`). The test must
  wait for the G0 recalculation before clicking: earlier attempts clicked while
  the preview was unavailable and did not exercise symmetry.
- A single-face synthetic STEP sheet was extended at a free edge. Numeric
  editing, local Undo/Redo, Apply, unchanged source geometry/topology and a
  valid two-face STEP copy with a shared edge were verified (`run-Big7HI`).
  A separate real-pointer test verified the visible strip, Escape, Undo and
  Redo without applying (`strip-drag-Hs5mQZ`). This is limited to one open
  sheet face, not an arbitrary multi-face object.
- In strip mode a D handle now uses the X/Y/Z direction selected in the panel;
  dragging the edge itself still moves in the screen plane. A real-pointer
  synthetic-sheet test verified the X handle, preview, Escape, Undo/Redo and
  reimport of a valid two-face sewn STEP (`strip-handle-xlmyGT`); equivalent
  Y and Z checks passed (`strip-handle-y-RAr0AU`, `strip-handle-z-0PFBpA`).
  Other sheet shapes and complete QS gesture equivalence remain unqualified.
- The same single-face sheet can now show D by clicking a free edge before
  opening the strip panel. In the shared source application the direct X path
  passed pointer preview, Escape, Undo/Redo and STEP reimport
  (`strip-handle-x-gBpzfU`); a regression check passed for the panel Z path
  (`strip-handle-z-yX62ui`). In a further direct X run a deliberately
  simulated boundary-read failure displayed an explicit Retry control, did not
  loop automatically, and recovered on the same revision (`strip-handle-x-tTHpez`).
  Preloading alone did not change the CAD draft or project history. These runs
  export a valid sewn STEP but do not apply it to a project; other sheet shapes,
  compiled desktop behavior and QS parity remain unqualified.
- The local STEP export was downloaded and reimported as a valid edited solid;
  the source body retained its CAD geometry and topology and no project history
  was added (`workspace-export-step-A22rAX`). With a draft note present, export
  stayed disabled and the note remained intact. STEP cannot contain these notes;
  annotated project publication is a separate host capability.
- Apply was rejected with a source-changed message in an open-sheet run and
  in a compiled-app run on a synthetic box. The captured stack showed that a
  synchronous reference-change callback reported through the frozen controller
  while the host was publishing, propagating an exception into the transaction.
  The layer now contains that observational reporting failure without changing
  the host's source guards. Two UI-import regression runs published correctly
  (`source-race-1rCTJY`). A separately compiled app applied an edited synthetic
  solid, saved and reopened the project, and exported two valid distinct solids
  (`compiled-hop0Gn`). This does not qualify a packaged desktop release.

The opt-in integration script is `tests/e2e-workspace-integration.mjs`. It
requires `SCANRULER_ISOLATED=1`, a local `APP_URL` with an explicit port and an
absolute `EDIT_SURFACE_QA_OUT` outside the app checkout. `STEP_FILE` is optional
and is read only; without it a synthetic box is created. `TEST_ZEBRA_NOTES=1`
adds the note/Zebra checks. Evidence, including user-derived screenshots, stays
in the selected local QA output, not in this repository.
`TEST_FACE_SWITCH=1` adds the viewport face-switch scenario and requires the
script's synthetic box rather than an operator-supplied STEP.
`TEST_ALIGNED_DEPTH=1` adds the normal-aligned pointer test on a synthetic box;
it can also be used with `tests/e2e-workspace-snap.mjs` in axis or local mode.
The separate `tests/e2e-workspace-snap.mjs` exercises the synthetic snap cases;
`EDIT_SURFACE_DRAG_MODE=axis|local|screen` selects the movement mode.
`tests/e2e-workspace-strip.mjs` and `tests/e2e-workspace-strip-drag.mjs` cover
the separate numeric/apply and pointer/cancel workflows. Generated fixtures,
screenshots and browser profiles belong outside the app checkout.
`tests/e2e-workspace-export-step.mjs` covers the local export and note guard.
`tests/e2e-workspace-g1.mjs` and `tests/e2e-workspace-strip-handle.mjs` cover
the sampled G1 boundary and the handle on their respective synthetic fixtures.
`tests/e2e-workspace-annotated.mjs` is the isolated real-controller annotated
Save/Load scenario; it needs an annotated-capable host with the corrected
oriented-normal handling, `SCANRULER_ISOLATED=1`, `APP_URL` fixed to
`http://127.0.0.1:17723/` and an absolute output folder outside the checkout.

## Face selection with draft notes

Changing the active face now offers to discard draft notes and edits together.
The notes remain if the confirmation is declined, the worker fails, or the CAD
source changes while the other face loads; they are cleared after successful
selection. `workspaceSession.test.ts` covers these paths through the session
controller, including a simulated worker failure and source change. An isolated
source-app browser run on a synthetic STEP box (`annotated-edit-kjCwsi`)
confirmed the decline and accept paths through the face selector, and then
created, saved and reopened an annotated CAD copy with Zebra active. The note
placement in this test used the controller; it did not verify a viewport click.
The opt-in scenario uses `TEST_NOTED_FACE_SWITCH=1` with the annotated QA script.
A packaged desktop release and arbitrary real-world projects remain untested.

The magnet reach field now accepts an intermediate value while typing and
commits on Enter or blur; Escape restores the prior value. Invalid ranges are
rejected and displayed. `TEST_SNAP_ENTRY=1` verified actual keyboard entry of
0.05 mm, rejection of zero, and Escape without closing the editor in the
isolated source app on a synthetic STEP (`annotated-edit-NBrigV`). The first
attempt failed in the test harness on its keyboard shortcut, before testing the
field; the corrected run passed. Packaged desktop behavior is not qualified.

## Not yet qualified

The new adapter has not yet been qualified in a packaged desktop release or
against every existing standalone-editor function. Transactional note saving
requires the corrected host V1 capability. The host owner reports a passing
compiled-browser run for the specific integration and fixture above; other
faces, real projects and a packaged desktop build remain unqualified.
An older host without that capability must continue to block annotated Apply.
Parametric replay and
editing an already existing NURBS face through this host
on further real-world topologies remain separate checks. Snap to the host's other CAD bodies uses their displayed
tessellation, not exact B-rep targets. Large-scan performance, real-world
snapping, real-project save/reopen and cancellation under delayed staging
require their own integrated checks. No Zebra equivalence with QuickSurface is
claimed.
# Experimental cylindrical drag preview

`previewPreparedCylinder` returns a display-only tessellation tagged `provisional`;
it does not check shape validity, export STEP, or authorize Apply. The current
revision must separately pass the full cylinder evaluation. The experimental
worker prepares a cylinder from its currently opened STEP and retains the
prepared BREP itself; preview and evaluation require its session identifier.
Open, normal selection, recipe restore and replay invalidate that identifier.
An isolated browser source-worker test on a synthetic cylinder verifies its provisional response, no STEP or validity flag,
rejection of a protected-pole edit, and STEP from `evaluateCylinder` reopens as
valid; reopening the STEP rejects the prior session. `CylinderPreviewSession` keeps delayed validation results and errors
from applying to newer candidates or a disposed session. It is not connected
to the normal nonperiodic Apply path. The shared workspace exposes an explicitly
experimental preview for the narrowly qualified full cylinder: only its
central pole is selectable and its coupled movement preserves the supported
net's seam/boundary rules. In isolated source-host QA, selecting a generated
STEP cylinder and dragging that pole with actual pointer events updated the
preview; after an explicit sampled CAD check, Apply created a separate CAD
copy. Undo invalidated that check and required another verification. The copy
export reopened as valid; the source STEP data remained identical, excluding
its timestamp-bearing header. The pole was initially outside the fitted view
and required zooming out. This does not qualify real user STEP files, all
cylinders, or freedom from self-intersections.
The worker can now create and resolve UV note anchors against the exact
evaluated cylinder face BREP and rejects an obsolete session/revision after
a new preview. Isolated source-worker QA on a synthetic cylinder measured a
round-trip point gap of approximately 1.8e-15 mm. This is only an anchoring
check, not scan accuracy. Isolated source-host QA on a synthetic cylinder also
exercised Zebra, a note, Undo/Redo and revalidation, annotated-copy Apply, and
save/reopen with the note marked verified. The note was placed with an actual
pointer click on the selected face; the Note button is enabled only after a
current CAD validation. Seam changes, real STEP, packaged desktop
and general persistence need further qualification.
On one synthetic imported cylinder, a local Vitest run
measured 44.6 ms for this preview and 1956.8 ms for full evaluation; this is
not a frame-rate or real-project benchmark. Complete lifecycle qualification,
control-net framing and real-project qualification remain open.

Isolated source-host QA additionally exercised a planar face of a 51-face CAD
solid derived from an earlier real-STEP test (`modified-test.step`, input
SHA-256 `29eba285dc5ed8622c933fc6e2507a774f9342c2b542d538da3e8dd27f98fef4`).
The viewport pointer gesture, numeric normal move, Undo/Redo and Apply-copy
passed; input hash stayed unchanged and both exported shapes reimported as
valid 51-face solids. The first attempt was obstructed by the support card;
the QA now dismisses it and picks only points actually over the canvas.
This is one planar face in a derived CAD file, not the cylindrical path,
packaged desktop qualification, or general QuickSurface parity. Evidence:
`scanruler-edit-surface-qa/run-sU9P0t/result.json` outside the checkout.

### Two axial handles on a simple cylinder

The experimental full-cylinder path uses exact cubic V refinement with two independently draggable axial controls. Coupled U poles protect the existing seam and the end rows. Isolated source-host QA exercised two pointer drags, sampled CAD validation, undo/redo, notes, Zebra, STEP and project reopen on a generated cylinder; this does not qualify other cylindrical faces or a packaged desktop build. Checks are finite and do not prove global absence of self-intersection. The previously observed periodic-cylinder volume discrepancy remains unresolved.

### Full cylindrical boss on a solid

The experimental gate also accepts a complete cylindrical face bounded by two full circles adjacent to distinct planar faces in a single solid. It rejects ambiguous or shared BREP support records before replacement. OCCT tests on generated STEP bosses cover one and two cylinders, STEP reimport and sampled preservation of other faces; the isolated source-host test covers pointer editing, verification, notes and project reopen on an eight-face boss. These results do not qualify arbitrary trims, shared or repeated TShapes, real customer STEP models, global self-intersections, or packaged desktop integration. The periodic volume discrepancy remains unresolved.
