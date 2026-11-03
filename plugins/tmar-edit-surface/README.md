# Edit Surface — CAD prototype checkpoint

2026-11-03 · branch `codex/edit-surface` · base `e90b4c68f16792faffcfa0423fca6b606dba703a`.

## What works

Open **Reverse Engineer → Edit Surface**, choose an existing CAD body or load a STEP file, then select an eligible face. Select poles (Ctrl for several), drag along X/Y/Z or enter a displacement. Local smoothing, flattening and stretching operate on selected unlocked poles. Undo/Redo are local while the editor is open. Apply imports an edited CAD copy through the host command/history system; the original remains intact.

The kernel edits actual B-spline/NURBS poles, retaining knots, degrees, weights and topology. The display is tessellated only for rendering. A planar face is converted exactly to a bicubic NURBS before editing; an eligible imported NURBS is edited directly. This is not a mesh conversion or a new approximate surface fit.

G0 locks the boundary pole ring. G1 also locks the next ring, preserving the original boundary derivatives. **G1 does not create tangency where the original adjacent faces were not tangent.** Individual point locks provide additional protection.

## Reuse and implementation boundary

Reuses ScanRuler's plugin panel extension, `reverse.export.step`, `reverse.import.step`, project history, Three.js and the existing pinned `occt-wasm` 5.7.1 kernel. SurfaceLab review did not identify an existing imported-STEP pole editor to transplant: its fitting/freeform reconstruction is a different operation. QUICKSURFACE is a functional reference; no proprietary decompiled implementation was copied.

The WASM wrapper does not expose surface pole setters or face replacement. A restricted OCCT ASCII BREP V3 adapter therefore changes only the selected support surface record and reads it back through OCCT. It rejects unsupported representations instead of guessing. Exact planar initialization may repair missing pcurves; deformed results are not automatically healed.

Only `plugins/tmar-edit-surface/**` is owned by this change. No SurfaceLab or shared ScanRuler application source was changed. The coordinator chat was busy and message delivery was rejected; do not treat this checkpoint as a received ACK. The commit can be integrated independently of the preceding Zebra branch.

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

## Limits / next acceptance

- Natural rectangular four-edge faces without internal trims; clamped nonperiodic NURBS, at most 1600 poles. Cylinders and arbitrary trimmed/holed faces are not editable here. Some mixed STEP/BREP representations are deliberately refused.
- One face at a time. Apply creates a new body, not an in-place feature-history edit. The control-net editing recipe is not persisted as a feature.
- OCCT validity, face/solid counts, positive volume, original boundary preservation, sampled normals and face intersections are checked. This is not exhaustive certification against every possible self-intersection; intersection edges and normals have sampled checks.
- No qualification yet on arbitrary production STEP parts, project save/reopen, touch input, multi-face continuity creation or full QUICKSURFACE equivalence. Locks are not part of the local geometry undo history.
- Preview is interactive and coalesced while dragging; exact frame rate and large-model latency have not been benchmarked.

Next acceptance: use a representative owner's STEP with an eligible NURBS face, verify protected adjacent geometry and project round-trip before broadening the supported trimming/topology domain.
