# Edit Surface — CAD prototype checkpoint

### Shared workspace: normal drag and integration, 2026-11-04

Pole movement starts on the surface's local normal N. U/V and world axes remain
selectable. When the chosen axis points almost directly at the camera, dragging
vertically moves the pole in depth; the view-scale mapping is approximate near
the threshold. This does not change the separate edge-duplication guard.
Synthetic shared-view tests cover the real pointer, Undo, valid STEP Apply and
snapping to scan and CAD with Alt/off. See `WORKSPACE-INTEGRATION.md` for the
exact revisions, results and the independent compiled integration of the
preceding plugin revision. A packaged desktop build and full QS parity are not
claimed.

### Scan/CAD snapping and direct-handle correction, 2026-11-03

When a body is loaded from the project, the editor can show the visible scan and other visible CAD bodies as translucent references. The magnet is on by default with a 1 mm adjustable reach; Alt temporarily disables it. During a pole drag it searches along the chosen world/local axis, or along the view direction for screen-plane movement, and labels a successful hit. Other faces of the edited body are also candidates; the edited face is excluded. Hidden project references are excluded. A STEP opened directly outside the project has no verified project coordinate relationship, so only its own other faces are offered as references; import it and load the project body to use the scan and other bodies. Reference hits use displayed tessellation; **a NURBS pole is generally not a point on the resulting surface**. Locked poles and existing geometry validation remain in force. No assertion of exact surface-to-scan contact or global G1 is made.

The visible scan geometry/BVH is borrowed without disposal; CAD references use wrappers around the existing immutable buffers. No host project geometry is modified during the drag. If a reference changes or disappears it ceases to be a candidate. This is independent of the Patch Network editor and does not qualify its snap or vertical movement.

The direct edge-duplication handle is offset and joined to its anchor by a leader; it is hidden while free-boundary editing is active, where the explicit duplication button remains available. Its drag is calibrated at the original edge anchor. Pole dragging now starts after four pixels; Escape during an active pole or D-handle drag restores the original draft instead of closing the editor. The latter was caught by independent review and verified with `--direct --cancel --escape --pending --chain` in source and compiled hosts; both result files are in `evidence/snap/escape-handle-*.json`.

Actual Chrome pointer/STEP readback tests passed in an isolated source host and in its compiled build for a 20×30×10 mm box and separate scan or CAD references at +2 mm. The sampled edited surface centre was **10.500 mm** with snap, and **10.375 mm** with Alt or snap off; the latter are not measurements of scanner accuracy. Escape restored the original draft in the scan fixture. Seven snap unit tests and two edge-picker unit tests passed, as did TypeScript and the compiled build. The unmodified free-boundary regression and the D/cancel/pending/chained-extension test passed both in the source host and the compiled build. Evidence and compact synthetic projects are in `evidence/snap/`; scripts are `tests/e2e-snap.mjs` and `tests/e2e-snap-cad.mjs`.

An additional independent OCCT reimport of the six snapped, Alt and disabled STEP exports from the compiled run found each shape valid, with one solid and six faces. The snapped volumes were 6075.001949994354 mm³ and the free-drag volumes 6056.251465043694 mm³ (`evidence/snap/independent-step-check.json`). This is a bounded check on the synthetic box, not a guarantee for arbitrary models.

Not yet qualified: a broad range of user projects, screen-plane/local-direction snapping, exact B-rep edges/vertices as targets, large-scan latency, changing reference visibility while the dialog remains open, or QuickSurface parity. The QS window was not capturable in this run. The compiled test initially timed out because it used a dev-only hook; the successful compiled runs above use the public project/UI path. The test host temporarily ran out of disk space; only known inactive browser-test profiles were removed, and Windows-blocked files were left untouched.

2026-11-03 · branch `codex/edit-surface` · base `e90b4c68f16792faffcfa0423fca6b606dba703a`.

## What works

Open **Reverse Engineer → Edit Surface**, choose an existing CAD body or load a STEP file, then select an eligible face. Select poles (Ctrl for several), drag along X/Y/Z or enter a displacement. Local smoothing, flattening and stretching operate on selected unlocked poles. Undo/Redo are local while the editor is open. Apply imports an edited CAD copy through the host command/history system; the original remains intact.

The kernel edits actual B-spline/NURBS poles. The display is tessellated only for rendering. A planar face is converted exactly to a bicubic NURBS before editing; an eligible imported NURBS is edited directly. A clamped bicubic 4×4 patch is first refined exactly to 5×5 by homogeneous midpoint knot insertion: this exposes one free interior pole under G1 protection, retaining the original shape, parameter domain and degree. Knots and weights are retained after that initialization. This is not a mesh conversion or a new approximate surface fit.

G0 locks the boundary pole ring. G1 also locks the next ring, preserving the original boundary derivatives. **G1 does not create tangency where the original adjacent faces were not tangent.** Individual point locks provide additional protection.

## Reuse and implementation boundary

Reuses ScanRuler's plugin panel extension, `reverse.export.step`, `reverse.import.step`, project history, Three.js and the existing pinned `occt-wasm` 5.7.1 kernel. SurfaceLab review did not identify an existing imported-STEP pole editor to transplant: its fitting/freeform reconstruction is a different operation. QUICKSURFACE is a functional reference; no proprietary decompiled implementation was copied.

The WASM wrapper does not expose surface pole setters or face replacement. A restricted OCCT ASCII BREP V3 adapter therefore changes only the selected support surface record and reads it back through OCCT. It rejects unsupported representations instead of guessing. Exact planar initialization may repair missing pcurves; deformed results are not automatically healed.

Only `plugins/tmar-edit-surface/**` is owned by this change. No SurfaceLab or shared ScanRuler application source was changed. The coordinator subsequently acknowledged the boundary and checked the ten external host imports against main `935f07f23a2311e8d90684590b8aac3d78ca0b5a` and its localization copy. This is a static compatibility ACK, not integrated runtime acceptance. Coordinator response: `a11f6599-6f27-4cfc-9fbf-184190a15948` in chat `6ae6453c-5db0-83ed-8dda-d92bc6a70daf`. The commit can be integrated independently of the preceding Zebra branch.

## Verified evidence

Real STEP fixture: a 20 × 30 × 10 mm solid, exported and then imported before editing. Tests did not rely solely on a newly created in-memory surface.

| Check | Result |
| --- | --- |
| Imported STEP face selection and pole movement | PASS |
| Real browser mouse drag of a pole | PASS |
| Local Undo and Ctrl+Y Redo | PASS |
| Point lock/unlock, smoothing, stretching, flattening | PASS |
| Reject pole movement across the opposite wall | PASS |
| Reject locked boundary edits | PASS |
| Export/reimport modified STEP; native NURBS re-edit | PASS |
| Host Apply creates CAD body; subsequent STEP export/reimport | PASS |
| Curved rational 4×4 STEP → exact 5×5 initialization → G1 edit | PASS |
| Save/reopen host project with edited CAD body | PASS, isolated browser |
| Browser console errors | 0 |
| TypeScript no-emit check | PASS |
| Vite production build including editor worker and WASM asset | PASS, 19.69 s |

The browser run measured volumes of 6000.000 mm³ initially, 6225.006 after numeric displacement, 6269.195 after dragging, 6134.598 after smoothing and 6147.519 after stretching. Flatten restored 6000.000. Undo flatten and Apply produced an exported STEP volume of **6147.519126596491 mm³**, valid on independent kernel reimport. Boundary sample differences were approximately 4–5e-15 mm: numerical roundoff on this synthetic CAD case, not scanner accuracy or a general geometric guarantee.

Evidence: `evidence/before.png`, `after.png`, `drag.png`, `applied.png`, `input-solid.step`, `modified-solid.step`, `kernel-run.log`, `ui-run.log`. An earlier `failure.png` records a resolved worker-WASM loading failure and is not current success evidence. Browser WASM loading now uses an explicit bundled asset URL. Build warnings concern externalized Node modules in dependencies and large chunks; the build completed.

Commands used:

```text
node node_modules/vitest/vitest.mjs run plugins/tmar-edit-surface/tests/editorKernel.test.ts
node plugins/tmar-edit-surface/tests/e2e-surface.mjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/vite/bin/vite.js build
```

The UI test uses a separate headless browser and an isolated development server on port 17531. No user's active CAD document was used. Runtime qualification is against the development app; production compilation is verified, but a packaged desktop release was not produced.

### Curved imported STEP and project round-trip, 2026-11-03

`tests/editorKernel.test.ts` now also exports a curved, rational, asymmetric 4×4 patch in a closed STEP solid, imports that STEP and checks refinement against independent OCCT surface evaluation. All six faces are sampled on a 13×13 grid; differences are below 1e-8 mm and normal dot products above 1 − 1e-10 before deformation. Both kernel tests passed; TypeScript passed. The earlier production build was not repeated for this refinement checkpoint.

`node plugins/tmar-edit-surface/tests/e2e-refined-surface.mjs` exercised the actual application: import STEP, choose its NURBS face, select the free central pole, move +3 mm in Z, apply the CAD body, save `.scanruler`, reopen it in a fresh browser page and export STEP again. PASS in 8.612 s, zero browser errors. Independent OCCT reimport confirmed validity, volume **6075.247994550057 → 6192.107966783208 mm³**, and the identical final volume after project reopening. The six faces' 9×9 sampled positions matched with measured maximum difference **0 mm** between edited and reopened exports. This is sampled round-trip evidence on the fixture, not a global precision claim.

Artifacts: `evidence/refined-roundtrip/run-Zlk2YR/` contains before/edited/reopened screenshots, input and result STEP files, the saved project and `result.json`. The screenshots were visually inspected. Local geometry Undo/Redo and drag were exercised in the earlier browser test; they were not redundantly retested by this round-trip case.

### Bounded QUICKSURFACE observation

Revo Design Pro 8.0.123, QA document `modified-solid`: the imported solid displays correctly. The context command **Edit…** did not expose a pole editor. **Duplicate Face** created a surface copy; double-clicking that copy displayed “Start editing selected object”, but after acknowledgment no control-point editor appeared. Undo removed the test duplicate and restored the single imported solid. This records only the observed route on this imported STEP; it does not establish that QS lacks another editing route or qualify feature parity. No user production document was modified.

## Limits / next acceptance

- Eligible clamped, nonperiodic NURBS have at most 1600 poles. Some planar and curved faces with internal or external trims are supported with conservative protection, as detailed below. Periodic cylinders, arbitrary trims and some mixed STEP/BREP representations remain unsupported or deliberately refused.
- One face at a time. Apply creates a new body, not an in-place feature-history edit. A versioned control-net recipe and strict replay API are available in the plugin worker; host feature-history persistence is not yet connected by this plugin checkpoint.
- OCCT validity, face/solid counts, positive volume, original boundary preservation, sampled normals and face intersections are checked. This is not exhaustive certification against every possible self-intersection; intersection edges and normals have sampled checks.
- No qualification yet on arbitrary production STEP parts, touch input, multi-face continuity creation or full QUICKSURFACE equivalence. Project save/reopen is qualified on the recorded fixture only.
- Preview is interactive and coalesced while dragging; exact frame rate and large-model latency have not been benchmarked.

Next acceptance: integrate the isolated plugin, use a representative owner's STEP with an eligible NURBS face and verify protected adjacent geometry before broadening the supported trimming/topology domain.

### Interaction controls checkpoint, 2026-11-03

Added adjustable drag strength (5–100%), local smoothing strength (5–100%), control-net visibility and surface transparency. Numeric displacements remain exact. Axis and strength are captured at drag start; display changes preserve the camera and geometry.

`tests/e2e-controls.mjs` passed against the real browser and independent STEP reimports in **10.325 s**, with zero console errors. The same mouse movement displaced the evaluated surface center by **0.2945899173967508 mm** at 100% and **0.14729495869850062 mm** at 50% (ratio 0.5000000000004251). Smoothing at 25% and 75% changed the center height from 11.5 mm to 11.125 mm and 10.375 mm respectively. All exported solids passed kernel validity checks. Hiding the net and enabling transparency changed the image without changing CAD status; restoring the display produced an identical canvas image. TypeScript passed; production build was not repeated for these controls.

Evidence: `evidence/controls/run-OClKPs/result.json`, screenshots and five STEP exports. The half-drag screenshot was visually inspected. Earlier local runs failed in the test harness while collecting repeated download filenames; exports now use separate download directories. Those failures are not product success evidence.

Additional bounded QS observation: New Freeform opened an Edit Surface panel containing Drag Strength, Control Net and transparency controls. This motivated the controls above, but their QS behavior was not functionally qualified. Closing that panel and Ctrl+Z did not remove the displayed Freeform item; the QA document was left unsaved. No claim of complete QS parity or native imported-face editing follows from this observation.

### Serializable edit recipe checkpoint, 2026-11-03

Added `recipe.ts` and three worker actions, documented in `RECIPE-INTEGRATION.md`. Recipes record the source body and geometry fingerprints, face index, exact preparation, sparse pole edits, continuity protection and individual locks. Replay refuses changed sources instead of silently choosing another face. Restore validates in a temporary editor before replacing the current session; a refused restore leaves the current editing session intact.

`tests/recipe.test.ts`: two real OCCT tests passed (3.45 s total), covering planar STEP, curved rational STEP with exact refinement, subsequent native-NURBS editing, STEP reimport and sampled geometry equality, plus malformed recipes and invalid edits. TypeScript passed. `tests/e2e-recipe.mjs`: browser worker contract passed in **3.724 s**, zero console errors. JSON serialization/replay/restore preserved the net, lock and valid solid volume **6094.724657678973 mm³**; rejected base signatures preserved the active draft. Evidence: `evidence/recipe/browser-result.json`. This run verifies the browser worker, **not** host history, project recipe persistence or annotated-body integration. Production build was not repeated.

Follow-up QS inspection reopened Edit Surface on the existing QA Freeform item. Clicking Control Net did not expose control points on the displayed imported solid. The comparison remains limited to observed UI controls; no imported-face deformation was qualified in QS.

### Explicit coordinates and shared runtime, 2026-11-03

Recipe version 2 declares millimetres and the imported STEP coordinate frame; experimental version 1 is rejected, without implicit migration. Injected kernels are borrowed and remain usable after editor disposal; editor-created kernels remain owned. Three kernel tests passed (3.57 s total), including a STEP metre-unit fixture normalized to mm and a borrowed-runtime lifetime check. TypeScript passed. This does not qualify host history or recipe persistence. See `RECIPE-INTEGRATION.md`.

### Screen-plane drag checkpoint, 2026-11-03

Added a choice between world-axis dragging and dragging in the camera plane. Screen dragging captures the plane and pointer offset at the start, preserves camera depth, respects pole locks and applies the selected drag strength. Numeric displacement and stretching still use the chosen X/Y/Z axis.

Bounded QS comparison on the separate `modified-solid` QA document: created a rectangular Freeform face, displayed Control Net, moved a corner and used Ctrl+Z to restore it. Selected Manipulator → Screen, moved the corner diagonally, then used Ctrl+Z to restore the rectangle again. The observed Screen manipulator follows the display. This is an actual Freeform interaction check; it does not qualify imported STEP pole editing in QS, Local mode, or complete parity. The original imported solid was preserved; the QA document remains unsaved.

`tests/e2e-screen-drag.mjs` passed in **8.170 s**, with zero browser errors. It imports a STEP solid, edits its top face using real mouse input, exports five STEP states and checks them independently in OCCT. Screen dragging changes the evaluated surface center by (-0.2928728, -0.0740030, +0.1659463) mm; the component along the view direction is **1.24e-13 mm**, numerical roundoff. Undo restores the original center and Redo restores the edited center. At 50% strength each displacement component is halved. Every exported solid is valid. TypeScript passed. Screenshot inspected; evidence in `evidence/screen-drag/run-MfDDsc/`. Production build and packaged desktop delivery were not repeated for this incremental checkpoint.

The first test launch failed before application interaction because the isolated browser could not start under the restricted launcher; the approved rerun produced the recorded passing result. No active user CAD session was used for this browser test.

### Local surface directions checkpoint, 2026-11-03

Added Local U/V/N alongside World XYZ and Screen. A selected pole is associated with its Greville parameters (average of the following degree-many expanded knots in each direction). Rational NURBS derivatives determine U, then N = normalized dU × dV and V = N × U. Thus V is the orthogonal tangent, not necessarily the original parametric dV direction; N is parametric, not necessarily the outward solid normal. Degenerate directions are refused with a UI diagnosis rather than replaced by a world axis.

The first selected unlocked pole anchors the frame for a multi-selection. All selected unlocked poles receive the same displacement. Direction and strength are captured at drag start. Numeric movement uses the current local frame; stretching remains explicitly World XYZ. The yellow arrow indicates the positive direction; users drag a pole, not the arrow itself. Recipe v2, imported-step coordinates in millimetres, and Apply-as-copy are unchanged.

`tests/localFrame.test.ts` passed (632 ms test time, 1.86 s overall). On a rotated curved rational STEP it compares local frames with independent OCCT normals at six Greville locations and the central U direction with an OCCT finite difference. The frame is orthonormal; a 0.5 mm normal pole movement preserves G1-protected borders below 1e-6 mm and exports a valid solid. Collapsed frames and invalid pole indices are rejected.

`tests/e2e-local-drag.mjs` passed in **11.453 s**, with zero browser errors. It imports a rotated STEP box, chooses its face, moves the central pole numerically along N, drags it with actual mouse input, and exports base/numeric/drag/Undo/Redo states for independent OCCT checks. Surface-center numeric displacement is (0, -0.1411606183, 0.2063339037) mm and drag displacement is (0, -0.1503776645, 0.2198064228) mm, both parallel to the independently known tilted normal (0, -0.5646424734, 0.8253356149). All five exported solids are valid; Undo and Redo reproduce the corresponding prior centers. Volumes: **6000.000 → 6037.501 → 6077.451 mm³**. The pole and evaluated surface center have different displacement magnitudes because of the spline basis.

Evidence: `evidence/local-drag/run-hlNnOd/` (result JSON, STEP files, before/after screenshots; after screenshot visually inspected). TypeScript and diff whitespace checks passed. An initial browser launch failed before UI interaction; the approved rerun is the passing evidence. No production build or packaged release was repeated. Camera-change invariance, half-strength local dragging, multi-point local gestures and recipe replay specifically after Local movement have not yet received separate UI qualification; previous Screen/recipe tests do not prove these combinations.

QS observation on the separate QA Freeform rectangle: selected Manipulator → Local, dragged a corner and restored it with Ctrl+Z. This confirms that interaction exists in QS, not equivalence of its exact local-frame convention or support for imported STEP editing. Arbitrarily trimmed/holed faces and cylinders remain outside this prototype's editable domain.

### Control-net segment selection checkpoint, 2026-11-03

Added Points, Segments and mixed selection modes. A control-net segment selects its two endpoint poles, not a topological CAD edge. Selected segments are yellow. Ctrl toggles endpoint membership; points take priority in mixed mode. Segment picking uses a seven-CSS-pixel screen distance and is disabled when the net is hidden. Dragging an already selected segment moves the selected unlocked poles together; locks and existing continuity protection remain effective. Selection itself does not create geometry Undo entries.

`tests/e2e-net-selection.mjs` passed in **7.871 s**, with zero browser console errors, on an imported 20 × 30 × 10 mm STEP solid. Seven interaction checks cover point-only exclusion, segment selection, shared-endpoint Ctrl toggling, hidden-net exclusion, mixed point priority, locked segment refusal and no Undo from selection. Numeric +1 mm Z on two poles changes the independently evaluated face center by **0.375 mm**, as predicted by the spline basis. Actual mouse dragging then changes its Z from **10.375 to 10.669314934944625 mm**. Five exported STEP states are independently valid; Undo/Redo reproduce the corresponding prior centers and volumes. Across 36 boundary samples, maximum change is **1.7763568394002505e-15 mm**. This is measured fixture evidence, not a global geometric accuracy claim.

Evidence: `evidence/net-selection/run-bDCaoF/` includes the five STEP exports, full result JSON and `selected-segment.png`. The screenshot was visually inspected: the selected segment and its two poles are yellow, protected boundary poles gray. The script now prints a compact summary while preserving full measurements in JSON; that output-only change received a syntax check without rerunning the passing geometry test. Source whitespace checks passed. No production build or packaged release was repeated for this checkpoint.

QS observation on the separate QA Freeform rectangle: Edges only with Show DUPLICATE handle enabled extended the face with a new strip. With duplication disabled, dragging the top edge moved it without adding a strip; Ctrl+Z restored the rectangle. The imported solid was preserved. Our control-net segment operation is the bounded deformation counterpart, not QS face duplication or proof of imported-STEP parity. Face selection, boundary selection, duplication and arbitrary trimmed-face editing remain unqualified or unsupported here.

Coordinator receipt: the preceding Local checkpoint `30fa75f` was integrated as `69a4806` on `review/edit-surface-integration-20261103`, PR #14 still draft. The coordinator reported targeted tests, TypeScript, production build and Local-N Windows/Chrome checks on that exact revision. These results do not qualify the new segment-selection increment.

### Selezione di celle del reticolo (STEP)
In QuickSurface, nel documento QA modified-solid, Faces only sulla singola faccia Freeform
ha selezionato i quattro angoli. Trascinamento di 30 px con duplicazione disattivata:
traslazione del riquadro senza striscia aggiunta; Undo ha ripristinato la posizione.
In ScanRuler scegliere Celle del reticolo per afferrare quattro poli della faccia STEP.
Il reticolo rappresenta la superficie NURBS: la cella non costituisce una faccia
topologica indipendente. Con G0/G1 restano fermi i poli protetti.

Prova: node plugins/tmar-edit-surface/tests/e2e-net-selection.mjs --cells.
Risultati in evidence/cell-selection/run-9iN6Il. Cinque esportazioni reali
lette dal link di download e reimportate in OCCT: sei facce valide, volumi positivi.
Centro Z: 10 -> 10.5625 (quota +1 sui quattro poli) -> 11.007922811 mm
(trascinamento); Undo e Redo riproducono i due stati. Scarto massimo su 36 campioni
del bordo 1.78e-15 mm. Questa prova non qualifica le facce con fori o la duplicazione.

### Face with an internal trim on an imported STEP plate

For an analytic plane with a rectangular outer boundary and internal wires,
the editor creates an exact bicubic plane with eight spans in each direction.
Poles whose basis support touches the conservative UV bounds of an inner wire
are protected in both the viewport and the kernel. This also preserves tangent
directions at the hole. On a narrow face these bounds can leave little free area.
The original single-wire plane preparation and its recipe fingerprint are unchanged.

Validation uses OCCT solid checks, the outer boundary and matched 3D trim curves
(33 samples per edge before/after planar conversion). The perforated face also
has an area check with a one-part-per-million allowance for integration of a
trimmed spline. The other faces keep the original absolute area check.
The kernel test includes rejection of a protected-pole edit and replay on the
original STEP. Curved NURBS input with internal trims is still unsupported.

In the browser QA, a mouse drag on the imported 48 x 48 x 10 mm plate changed
its volume from 22757.256661 to 22815.467778 cubic millimetres. Independent
STEP reimport returned a valid seven-face solid with two wires on its edited
face. All 72 sampled positions of the 6 mm hole rim matched the original.
Evidence and before/after STEP: evidence/perforated/run-tYwpbn/.

### Second edit after reopening a perforated curved STEP

The exported plate above can be reopened as a native clamped NURBS. For a
curved face the editor now bounds each nonempty knot span by its active
positive-weight control hull in 3D. Where the enclosing boxes of a span and
an internal wire overlap, every influencing pole is protected. This leaves
the original trim and tangent in place while allowing edits elsewhere. The
conservative bound can lock more points than strictly necessary. The existing
rectangular outer-boundary and nonperiodic-surface restrictions still apply.

The browser test with `--reopen` loaded the actual preceding export, moved a
second pole, and exported the result again. Independent reimport returned a
valid seven-face solid with two wires on the edited face. Volume increased
from 22815.467778 to 22873.205669 cubic millimetres. All 72 checked rim
positions matched the original hole. The kernel regression also rejects a
protected-pole edit and replays the second edit as a native NURBS recipe.
Evidence: evidence/perforated/run-lOxVW8/.

### External trims on imported CAD faces

Nonrectangular outer wires now contribute protected regions around their edges.
Circular arcs use enclosing chord boxes expanded by their sagitta. Pole support
may conservatively prevent movement near an edge, especially on coarse nets.
Periodic surfaces, generic underlying analytic surface types, and trims whose
UV bounding extents differ from the underlying spline knot domain remain limited.

Browser QA on a five-sided plate with a through hole: the center-area pole was
dragged, and STEP export/reimport produced a valid eight-face solid retaining
both boundary loops. Volume changed from 22037.256661 to 22095.419708 mm3.
Maximum discrepancy on the chamfer (33 samples) and the hole rim (72 samples):
1.78e-15 mm on this fixture. Evidence: evidence/trimmed-outer/run-hkrJJC/.
Run tests/e2e-perforated.mjs with --chamfer to reproduce.

A separate OCCT regression moves the center of a circular STEP face, reimports
the result and checks its rim at 72 positions. During exact planar preparation,
the spline quadrature differed from analytic disk area by 0.002631 mm2 on a
24 mm radius disk. For a single trimmed planar loop, discrepancies between
one and ten ppm undergo an independent check using the converted wire on the
original plane (1e-6 mm2 tolerance) and 144 inside/outside classifications.
Larger differences remain a refusal.

### Duplicate a free outer edge on an open CAD sheet

On an editable single-face STEP sheet, Duplica bordo libero exposes X/Y/Z
dragging of a highlighted outer edge. The preview follows the pointer. On
release the worker extrudes the exact edge, rejects degeneracy, overlap or
sampled intersection away from the original seam, and sews and validates the
two faces. Undo/Redo restores the accepted strip proposal. Export writes that
sewn sheet. This is a single strip proposal relative to the working face;
chained extensions, mesh snapping and project-history Apply are not qualified.

A 20 by 30 mm rectangular STEP sheet produced an added area of 150 mm2 for
a 5 mm numeric kernel test. The real viewport drag produced 149.959599 mm2;
the original face remained 600 mm2. Undo/Redo and independent reimport
confirmed two valid faces with one shared topological edge. The test also
covers overlap refusal and refusal on closed solids.
Evidence: evidence/duplicate-edge/run-PU4ViG/.

### Consecutive free-edge extensions

Duplica bordo libero keeps the accepted shell visible and exposes its remaining
outer boundary edges after each drag. An edge shared by two faces is no longer
a handle. Local undo and redo restore the accepted geometry, its handles and its
STEP export together. The chain is rebuilt from the validated working sheet,
matching a recorded edge path and refusing ambiguous or missing matches. A
chain is limited to 64 moves, with the initial state and up to 11 recent
snapshots retained for local undo. Imported open shells with multiple faces
can be extended after selecting an eligible working face.

Browser QA in development and production used a 20 x 30 mm sheet, a horizontal
drag of about 5 mm and a second drag of about 4 mm in Z on the newly created
edge. Undo of the second drag returned to two faces. Redo restored three.
Independent reimport found one valid sheet with face areas 600.000, 149.960
and 119.996 mm2 and two shared edges. The separate kernel check reopens the
three-face STEP, adds another strip and measures 930 mm2 across four faces on
the exact numerical fixture. The UI test exercises STEP export, not host Apply.
Evidence: evidence/duplicate-edge/run-u6mbbR/ (production).

### Loading the current CAD body

On a host registering `reverse.body.edit_source`, Carica corpo reads the
selected built CAD body, including a moved open sheet. The host's body key and
build version are checked again after this editor's worker opens the STEP.
If the document changes during the read, the editor refuses the stale result
and clears the old face list. The host's general STEP export policy is unchanged.

On older hosts without this command, the existing export path remains available.
The archived STEP fallback is restricted to a single unmodified imported sheet;
its resource key is checked before opening it. This fallback does not establish
a general way to read sheets modified by later project features.

The integration fixture combined the coordinator's host revision `8d12863`
with this plugin in an isolated source tree. A 20 x 30 mm sheet was imported
and moved +40 mm in X. Carica corpo opened the moved geometry, two strips were
created, and host Undo/Redo plus project save/reopen passed. Independent OCCT
readback found Xmin 39.9999999 mm, one original face and three sewn faces.
The compiled application separately reopened both bodies using the buttons in
the saved project and exported valid CAD at the moved coordinates. A separate
test held the editor worker's open request while the host really moved the
body. The stale read was refused; after reopening, the moved STEP read back at
X=40..60 mm. On the older host, a valid but mismatched STEP stored under the old
resource key was refused. The worker delay and resource corruption are test
instrumentation; the host move and CAD operations use the real runtime.

Evidence: `evidence/current-source/host-moved-20261103/`,
`host-compiled-20261103/`, `host-stale-20261103/` and `run-9Xi77S/`.
The integrated host remains a draft and the full QuickSurface comparison,
annotated Apply and parametric feature integration are still open.

### Move the free boundary of a single open face

For an open sheet containing exactly one eligible face with a natural
four-sided boundary and no holes, the editor offers an explicit option to
move boundary poles. The four CAD edges are rebuilt as exact isocurves of the
modified NURBS surface, and the resulting face is checked for validity and
domain coverage. Manually locked poles remain protected. The normal G0/G1
boundary protection is not active while this option is enabled. Solids,
multi-face sheets and trimmed faces retain their previous protection.

A browser test on an imported 20 x 30 mm STEP sheet selected two boundary
poles, tested their locks, dragged them, checked Undo/Redo, and exported the
result. Independent OCCT STEP reimport found one valid B-spline face and no
solid; its highest point moved from 10 to 11.4005 mm. The same test passed
on the compiled application in an isolated tree using host revision
`8d12863`, without browser console errors. Kernel tests also exercised an
asymmetric rational NURBS surface and refused free-boundary mode on a solid.
Evidence: `evidence/free-boundary/compiled-20261103/`.
Separate OCCT regressions also refused this mode on a single open face with a
hole and on a sewn multi-face sheet, leaving their boundaries protected.

In a separate source-host test on the same isolated host revision, Apply
created a second CAD sheet, project Undo/Redo restored one/two bodies, and
save/reopen preserved both. Independent STEP readback measured the original
and edited maximum heights as 10 and 11.4005 mm. The reopened edited sheet
could be loaded into Edit Surface again. The test used the application command
interface to prepare the fixture; its edit, Apply and project controls used
the visible UI. Evidence: `evidence/free-boundary/host-roundtrip-20261103/`.

This is a bounded prototype, not general free-boundary editing or a claim of
QUICKSURFACE equivalence. The author's host save/reopen test used the recorded
source-host fixture. The coordinator separately reports a compiled-UI
round-trip for integration `c92404c` in PR #14, not arbitrary project coverage.

### Free-boundary replay contract

The worker can now serialize and replay the supported free-boundary edit as a
version 3 recipe with an explicit `free-natural` boundary mode. Existing v2
recipes retain protected boundaries and their original format. Replay checks
the source, prepared net and actual boundary eligibility; individual locks,
including locks on the free rim, are returned on restore. Invalid modes,
changed sources, solids and a holed open face are refused. Rational weights
and sampled geometry were checked on STEP replay. Source and compiled browser
worker evidence: `evidence/recipe/browser-free-boundary-v3.json` and
`evidence/recipe/browser-free-boundary-v3-compiled.json`.

This is the plugin-side recipe contract only. The host has not yet integrated
the parametric feature or qualified recipe persistence in project history.

### Live CAD preview during point dragging

Point dragging schedules CAD evaluations while the pointer is still moving.
Only one evaluation runs at a time; pending movements are coalesced into the
latest request. A valid intermediate result may be displayed while dragging,
but Apply, STEP export and note placement remain disabled until the result
matches the current control net and continuity settings. Results belonging to
an earlier source, face or mode cannot replace the current preview.

On the 20 x 30 x 10 mm imported STEP fixture, the earlier implementation
showed no updated CAD preview in 24 observations made while the mouse was
held down. The updated source and the compiled isolated host both showed a
changed, validated preview in 21 of 24 observations; after release the
exported STEP independently reopened as a valid solid with the displayed
volume. A test-only delay also checked that an obsolete failed calculation or
an old G1 result cannot enable Apply or replace a G0 preview, and that closing
the editor with an evaluation pending leaves it closed. A separate free-edge
drag and STEP readback passed. These are bounded fixture results, not a frame
rate guarantee or evidence of full QuickSurface parity.

Evidence: `evidence/live-preview/baseline-20261103/`,
`source-20261103/` and `compiled-20261103/`.

### Local history for point locks and boundary modes

Undo/Redo and Ctrl+Z/Ctrl+Y now follow the order of geometry edits, manual
point locks, G0/G1 protection and free-boundary mode. Selection alone and a
lock operation that changes nothing do not add history. Undoing a lock does
not recalculate unchanged CAD or enable Apply while a geometry update is
pending. A new action after Undo discards Redo. Changing the source or face
starts a fresh history; if opening a STEP fails, old frames cannot be restored
against the worker's new document. The error does not claim an old preview is
visible after that preview has been cleared.

Before the change, the compiled baseline had no Undo action after a point was
locked. In source and compiled isolated UI tests, an imported STEP solid and
a single-face STEP sheet passed mixed lock/move/mode Undo/Redo; the exported
results reopened as valid CAD. The checks also cover G1 refusal when protected
poles moved, redo branching, unchanged geometry for lock-only history, a
delayed evaluation and a failed load. Worker delay and invalid STEP injection
are test instrumentation. This does not establish QuickSurface parity or
project-level persistence of the local editing history.

Evidence: `evidence/history/baseline-20261103/`, `source-20261103/` and
`compiled-20261103/`. The existing segment/cell selection and live-preview
regressions also passed on the source fixture.

### Direct editing of partially trimmed NURBS STEP faces

Some imported STEP faces occupy only a part of a larger, clamped NURBS
support. The previous editor refused those faces. It now edits their existing
control net directly, preserving the CAD support and protecting every pole
that may influence an outer or inner trim. The potentially free boundary
option is unavailable for these trimmed faces. Automatically protected poles
outside the face's parameter bounds are hidden only when they are also locked
under G0; the underlying net and pole indices are unchanged. Segments and
cells containing hidden poles cannot be selected.

Before this change the imported test face was refused with "Il trim non
coincide con il dominio NURBS." Three OCCT STEP round-trip tests now pass for
planar, curved rational, and curved rational perforated NURBS faces. They check
validity, protected boundaries and adjacent faces, sampled surface positions
and normals, and replay of the edit recipe. On the curved fixture, source and
compiled UI tests selected the previously refused face, dragged an editable
pole, exported STEP and reopened a valid solid. One hundred sampled outer-edge
points had a maximum measured distance of 0 mm in these runs; this is a
fixture-specific sampled check, not a general accuracy guarantee. Fifteen
relevant kernel tests and compiled point/segment/cell selection regressions
passed. Evidence: `evidence/partial-domain/source-20261103/` and
`evidence/partial-domain/compiled-20261103/`.

The conservative trim protection may leave few or no editable poles on some
faces. Periodic and analytic cylindrical surfaces remain unsupported by this
path. These results do not establish QUICKSURFACE parity, universal G1
continuity, or qualification on arbitrary customer STEP files.

### Direct control-net selection and navigation

The default mode now picks the control net directly in the order point,
segment, then cell. A hovered item is highlighted before the click; Ctrl-click
adds or removes its poles. Optional selection filters remain available under
an expandable section. Hidden or protected poles retain their existing rules.
Left drag on empty space no longer turns the model. Middle drag rotates,
right drag pans and the wheel zooms in this editor. Pointer capture also
covers a locked or selection-only gesture, so releasing outside the canvas
does not leave navigation disabled.

On the imported STEP test solid, the previous compiled baseline had Points as
its default and left-dragging empty space changed the view. The source and
compiled tests now confirm the direct default, visible point/segment/cell
hover, selection and Ctrl toggle, pole drag and Undo, cancellation, release
outside the canvas and all three navigation gestures. Existing segment and
cell regressions passed; note placement while Zebra is enabled also passed in
the source app. TypeScript and the isolated production build passed. Evidence:
`evidence/direct-selection/baseline-20261103/`, `source-20261103/` and
`compiled-20261103/`. The displayed screenshots were inspected.

These checks use a small test net; responsiveness on large control nets,
parity of every QS gesture and the direct D handle for duplicating a free edge
remain unqualified. The prior separate free-edge command remains available.

### Direct D handle for open sheets

For a compatible, validated open STEP sheet, including a multi-face shell, the editor prepares its
free CAD edges. Click a free edge and drag its D handle along the selected
world X/Y/Z axis: the new strip is previewed during the drag and validated as
CAD on release. A click without movement or a pointer cancellation returns to
the original face editor without creating a strip. During a pending operation,
a synchronous guard blocks another strip gesture, Undo and Apply. The handle
is not offered for solid faces or while a note is being placed.

This reuses the existing ruled-strip extrusion and sewing operation; it does
not refit the original surface and does not guarantee tangent continuity. After
the first extension the existing strip workflow permits further edge drags,
Undo/Redo and an explicit Apply as a separate CAD body. On a synthetic imported
two-face shell, simulated pointer tests exercised a first extension, project
save/reopen and a second extension; shared seams were not offered as free
edges and preceding sources were preserved. Details and limits are in
`MULTIFACE-D-CHECKPOINT.md`. The handle is not offered on solid faces. Physical
input, packaged-desktop behavior and QS interaction parity remain unverified.

On a synthetic imported STEP sheet, the source and compiled UI tests exercised
edge click, D drag, live preview, click-without-drag, pointer cancellation,
Undo/Redo and a second extension. The compiled test also held the worker
response and confirmed that a second gesture was blocked; a separate test
injected a rejected request and confirmed the last valid state could still be
edited. Independent OCCT import confirmed a valid three-face shell with two
shared edges and areas approximately 600, 149.955 and 119.996 mm². A source
host test applied it as a second body, verified project Undo/Redo, saved and
reopened the project, and reopened the edited sheet. The two-unit-test edge
picker check covers perspective anchoring and a forced choice among nearby
edges. The worker delay and rejected request are test instrumentation. No
arbitrary customer STEP, curved edge, touch device or full QS comparison was
qualified.

Evidence: `evidence/duplicate-edge/direct-host-20261103/`,
`direct-compiled-20261103/`, and `direct-reject-20261103/`.


## Main-view preparation · 2026-11-03

The existing prototype now uses the same reusable control-cage drawing and screen-space segment/cell picker intended for the shared viewport. The picker supports orthographic and perspective cameras and a separate part-to-world transform; its isolated tests do not prove host interaction or occlusion by other objects. The current editor is still a separate dialog.

With an imported synthetic 20 × 30 × 10 mm STEP solid, the source UI passed the point/segment and cell gesture checks; the compiled UI passed the cell check. Both paths exported and reimported valid six-face CAD, including the changed cell and Undo/Redo states; no console errors were recorded. TypeScript and 18 focused tests passed. Reports and a compiled-UI screenshot are in `evidence/main-view-preparation/`. These tests do not establish main-view integration, large-scan performance, QuickSurface equivalence or real-project acceptance.


### Session and drag preparation

The prototype groups its worker, local geometry history and coalesced preview queue in a session-owned `SurfaceRuntime`. `SurfaceDraft` owns the editable net, selected points, locks, boundary settings and preview validity; the session also retains draft notes and Zebra options. Temporary strip state and other display options remain in the dialog, so this is **not yet** the host workspace controller. The shared drag calculation accepts orthographic or perspective projection and rigid part transforms; the current prototype still runs in its own perspective viewport. A pointer other than the one that started a drag is ignored, and Escape releases its capture immediately.

On synthetic CAD, the source and compiled prototype passed scan-snap/Alt/off, Escape and the second-pointer checks; the final compiled prototype showed a changed valid preview during 20 of 24 observations while dragging. Source checks also covered screen-plane and local-normal motion, open-boundary editing, and Zebra draft notes. A source-only isolated test delivered a real worker reply after closing the editor and observed no project body, feature or STEP-file insertion. Reports are in `evidence/main-view-preparation/`; results are bounded to these fixtures and are not a release or main-viewport qualification.

The current Apply path can still enqueue a host import after its last source check. A command already queued or started is **not** cancelled by closing this prototype. The coordinator must complete the host-side execution-time guard and atomic transaction before integrated Apply is qualified. Notes in the current prototype remain draft-only unless a compatible host callback is installed.

### Draft controller and preview preparation

The existing dialog now uses `SurfaceDraft` as the sole authority for geometry, local history and CAD-preview scheduling. A session retains that controller outside the panel; it is not yet the host workspace session. `SurfaceGesture` handles the prototype's point drag, including pointer identity, the drag threshold, Alt and cancellation. `WorkspacePreview` prepares owned face meshes for the eventual shared viewport; it does not create a camera or renderer and is not yet connected to the host. Its source-mask callback must be atomic and restore only the host's temporary mask.

On isolated synthetic STEP fixtures, the integrated source dialog passed history, locks, protected boundaries, failure recovery, point/edge/cell selection, drag and scan snap; the compiled prototype passed CAD-reference snap, Alt and disabled snap. A source test with Zebra and a note observed a successful `noteResolve` for the new surface revision after STEP export; the note remained a draft and annotated Apply remained disabled. TypeScript and 33 focused controller/gesture/preview tests passed. Results are in `evidence/main-view-preparation/`; a perspective error found and corrected in the CAD-snap test is documented in `evidence/snap/cad-perspective-qa-20261103.md`. These results do not demonstrate shared-viewport integration, persistence of notes, arbitrary STEP support or QuickSurface parity.
