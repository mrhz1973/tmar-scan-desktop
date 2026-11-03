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
- One face at a time. Apply creates a new body, not an in-place feature-history edit. The control-net editing recipe is not persisted as a feature.
- OCCT validity, face/solid counts, positive volume, original boundary preservation, sampled normals and face intersections are checked. This is not exhaustive certification against every possible self-intersection; intersection edges and normals have sampled checks.
- No qualification yet on arbitrary production STEP parts, touch input, multi-face continuity creation or full QUICKSURFACE equivalence. Project save/reopen is qualified on the recorded fixture only. Locks are not part of the local geometry undo history.
- Preview is interactive and coalesced while dragging; exact frame rate and large-model latency have not been benchmarked.

Next acceptance: integrate the isolated plugin, use a representative owner's STEP with an eligible NURBS face and verify protected adjacent geometry before broadening the supported trimming/topology domain.
