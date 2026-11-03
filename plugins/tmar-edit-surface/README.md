# Edit Surface — CAD prototype checkpoint

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

- Natural rectangular four-edge faces without internal trims; clamped nonperiodic NURBS, at most 1600 poles. Cylinders and arbitrary trimmed/holed faces are not editable here. Some mixed STEP/BREP representations are deliberately refused.
- One face at a time. Apply creates a new body, not an in-place feature-history edit. A versioned control-net recipe and strict replay API are available in the plugin worker; host feature-history persistence is not yet connected by this plugin checkpoint.
- OCCT validity, face/solid counts, positive volume, original boundary preservation, sampled normals and face intersections are checked. This is not exhaustive certification against every possible self-intersection; intersection edges and normals have sampled checks.
- No qualification yet on arbitrary production STEP parts, touch input, multi-face continuity creation or full QUICKSURFACE equivalence. Project save/reopen is qualified on the recorded fixture only. Locks are not part of the local geometry undo history.
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
