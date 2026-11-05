# Edit Surface: host-side opt-in history preflight (2026-11-05)

## Exact provenance and ownership
- Host parent: `92286e6145a5c580a82a580286f0d262de9078fa`, draft PR #32.
- Plugin reference, QA **only**: `767d3cc5eba228fa604458b1e507bb3775ea769b`; only the author owns `plugins/tmar-edit-surface/**`.
- Isolated QA: `D:\TMAR-QA\tmar-host32-edit767-history-qa-20261105`.
- Scope: reverse-engineer host `plugins/reverse/**`; no deployment, merge, release or CAD user-profile changes.

## What is implemented (opt-in, not advertised as an editable feature)
1. `surfaceEditHistory.ts` establishes an explicit, versioned and bounded JSON envelope for a v2–v6 surface recipe, the exact archived source STEP, the current CAD copy, source/body identity, digest of the recipe, original bytes and stable replay comparison.
2. `qualifySurfaceHistory` takes a host-derived `SourceBinding`, plugin `prepareHistoryRecipe` snapshot, source freshness callback, original STEP and current final STEP. It refuses notes, invalid sources, changed epochs and aborted work. Before offering a one-use in-memory qualification token, it invokes an independent replay provider and checks that the replay matches the final STEP under a deliberately restricted canonical representation.
3. `stageEditorCopy(..., history?)` is an **internal opt-in extension**, not a new public UI mode. The ordinary unannotated and annotated copy paths are unchanged when `history` is absent. For a valid token it rereads the actual source body, verifies the source's stable identity, stages the STEP copy together with its upstream source and history envelope in a candidate isolated kernel, and adds them inside the existing single `historyAtomic` commit. Refused/stale sources never publish any changes.
4. ImportFeature may optionally carry `surfaceEditHistory` metadata (still `kind:'import'`, **not** a live editable `surfaceEdit` feature). `projectSection` preserves its upstream STEP in `reverse-steps.json` beside the final copy. Undo/Redo and project roundtrip are exercised in the test.
5. `reopenSurfaceHistory` is currently **read-only**: verifies saved source/result/recipe digests and independently replays through a supplied provider; otherwise returns `copy-only` with a reason. The saved result STEP remains the source of truth. It never overwrites a CAD body on failure.

## Exporter metadata vs CAD identity
Open CASCADE 8.0 may change the translator PRODUCT label sequence and STEP `FILE_NAME` timestamp between otherwise equal CAD replay exports (independently observed in QA). File hashes remain strict for archived bytes, while a separate stable fingerprint normalizes **only** exactly identified translator-label serials and the timestamp in that exact OCCT header. No coordinate, entity, topology or numeric geometry data are ignored. Any other unexpected STEP serialization difference fails closed. This is still not a universal CAD-equivalence proof and must not be presented as one.

## Required author/host coordination before a usable parametric history feature
- **Freeze history contract:** `isHistoryRecipeStampCurrent` currently requires `!frozen`, so there is no atomic freeze that both preserves the recipe stamp and holds the mutable controller through host asynchronous staging. Define `freezeHistoryRecipe(ticket)` and a release handle, or another versioned immutable plugin receipt whose validity is checkable at the host commit boundary. Merely checking before an await is insufficient.
- **Replay ownership:** host must own the independent `SurfaceEditorKernel`/worker replay provider, timeouts, cancellation, version dispatch and engine validation for v2–v6 (v6 has a dedicated `replayCurvedRecipe` contract). Never accept a client-supplied success flag or replay text as authentication.
- **Restore to editor:** plugin needs `restoreHistoryRecipe` on `WorkspaceSurfaceSession` via v2–v5 or the dedicated v6 dispatcher with exact source/face correspondence and fresh session identity. Currently only isolated kernel/draft restore is available, not a host editor-open workflow.
- **Genuine feature history:** after passing these, consider a separate `surfaceEdit` feature kind with stable source-body dependency, solver/undo/redo semantics, rebuild-time replay and robust topological source remapping; don't mislabel the current Import+envelope as a fully parametric editable feature. For draft-only previews, the stored import remains safe.
- **Notes:** current preflight explicitly refuses any notes; do not silently drop/rewrite them. A future annotated-parametric contract must include verified note UUID, face witnesses, post-replay re-anchoring, orphan policy and atomic rollback of CAD/history/notes.
- **Edge cases:** strip and provisional cylinder forbidden, changed scan/frame/session/source fails closed, stale/duplicated source ID forbidden, source bytes and STEP version/units must match; arbitrary trimmed, rational and periodic surfaces, multibody operations and QuickSurface parity remain unqualified.
- **Acceptance:** compiled browser UI and packaged desktop, synthetic and real scans, independent reviewer, injected failure/abort, stale stage/undo, save/load in a fresh process, notes, v5/v6 G1 and face remap before enabling or merging.

## QA evidence and caveats
- Synthetic real-OCCT replay and guarded reopening: PASS (tests `surfaceEditHistoryContract.test.ts`).
- Isolated host publish into existing CAD history, Undo/Redo, project save and load and recheck: PASS (`surfaceEditHistoryHost.test.ts`).
- Targeted regression on seven test files, including prior annotated copy/import/edit workflows: 133/133 PASS. TypeScript check: PASS.
- Test-only `qa-vitest-history.config.ts` grants access to the preexisting node_modules junction for QA; it must not be added to the host PR.
- No plugin edits staged for the host-only PR. No functional UI flag enabled. **DRAFT / HOLD.**
