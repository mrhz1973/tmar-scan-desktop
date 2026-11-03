# Edit Surface recipe integration contract

2026-11-03. Plugin-owned API for the coordinator's proposed `surfaceEdit` feature. Existing Apply-copy behavior remains available. No host feature registration is included here.

## Worker requests

All requests carry an `id`; replies carry `{id, result}` or `{id, error}`. The worker processes requests sequentially.

- `createRecipe`: after `open` and `select`, pass `net`, `continuity`, `lockedPoles`, and the host's stable `bodyId`. Returns a JSON-safe `SurfaceEditRecipe` after CAD validation.
- `replayRecipe`: pass the original upstream `step`, saved `recipe`, and `bodyId`. Returns the validated preview including `step` for rebuilding the host feature. Does not alter the worker's interactive session.
- `restoreRecipe`: same inputs as replay. Returns `{faces, net, preview, continuity, lockedPoles}` and adopts the validated source/face as the interactive base. Restore the returned net and locks in the UI. Failed restoration preserves the previous session.

The upstream input is the source before this surface edit, not the previously edited result. The exact imported BREP SHA-256, face/solid counts, face index, prepared NURBS SHA-256 and preparation type must match. This is deliberately strict: equivalent STEP exports can serialize differently and may require explicit reattachment. No automatic topological remapping is attempted. Engine/schema mismatches are rejected.

Pole edits use absolute positions relative to the prepared base net, not accumulated transforms. Locks protect the edited positions on reopening. Boundary protection is independently validated; G1 retains original boundary derivatives and does not create new tangency.

## Host ownership and acceptance still required

The coordinator owns feature registration, source dependency tracking, one host Undo/Redo transaction, project serialization, feature reopening and stale-source diagnostics. Preserve or explicitly flag notes/dependent references; do not silently reattach them to changed faces. Keep Apply-copy available during integration.

Remaining acceptance: import an annotated CAD body, create/reopen a `surfaceEdit` feature, host Undo/Redo, save/reopen the project, and verify notes, source body and dependencies. Worker tests do not establish those host behaviors.

## Verified checks

Kernel: `node node_modules/vitest/vitest.mjs run plugins/tmar-edit-surface/tests/recipe.test.ts` — two tests passed on imported planar and curved STEP, including replay STEP reimport and rejected restores.

Browser worker: `node plugins/tmar-edit-surface/tests/e2e-recipe.mjs` — passed against the existing isolated development server; report in `evidence/recipe/browser-result.json`. TypeScript no-emit passed. No new packaged desktop release is claimed.
