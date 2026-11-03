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
An armed note, an in-flight note pick or a draft note blocks Apply. Existing
notes are not written by this first `cad-copy` contract.

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
  source render geometry, project build and history. Persistent annotated
  Apply is not yet available.
- Separate isolated source-app snap cases used a synthetic scan and a second
  synthetic CAD body. In both, the pole snapped from Z=10 to Z=12 mm; Alt and
  disabling snapping left the same approximately Z=11.5 mm free movement.
  The test checked source feedback, the borrowed geometry and one canvas. CAD
  targets were displayed tessellations. No large-scan timing was measured.
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
The separate `tests/e2e-workspace-snap.mjs` exercises the synthetic snap cases.
`tests/e2e-workspace-strip.mjs` and `tests/e2e-workspace-strip-drag.mjs` cover
the separate numeric/apply and pointer/cancel workflows. Generated fixtures,
screenshots and browser profiles belong outside the app checkout.
`tests/e2e-workspace-export-step.mjs` covers the local export and note guard.
`tests/e2e-workspace-g1.mjs` and `tests/e2e-workspace-strip-handle.mjs` cover
the sampled G1 boundary and the handle on their respective synthetic fixtures.

## Not yet qualified

The new adapter has not yet been qualified in a packaged desktop release or
against every existing standalone-editor function. Transactional note saving,
parametric replay and editing an already existing NURBS face through this host
on further real-world topologies remain separate checks. Snap to the host's other CAD bodies uses their displayed
tessellation, not exact B-rep targets. Large-scan performance, real-world
snapping, real-project save/reopen and cancellation under delayed staging
require their own integrated checks. No Zebra equivalence with QuickSurface is
claimed.
