# TMAR ScanRuler — Host-only parametric history recovery (opt-in research)

Date: 2026-11-07. Status: **DRAFT / HOLD**. Parent host PR #39 `b11ad183ad8393c66554957eb7d453132fab385f`. QA plugin overlay: `codex/edit-surface` `ab270be2e17c8ae34d8c22c3e8743206420551dd`.

## Coordination and ownership
Coordination recorded on host PR #37 before writing this code. This change modifies only `plugins/reverse/**` and this host document. It does not modify `plugins/tmar-edit-surface/**`, `src/plugins/workspaceEditors.ts`, `src/viewer/**`, active CAD files, the plugin's v6 recipe or `restoreHistoryBundle` contract.

## New opt-in, off-screen host entrypoint
`prepareHostSurfaceHistoryRecovery(request)` in `plugins/reverse/app/surfaceHistoryRecovery.ts`:
- Selects exactly one active, existing `ImportFeature` with a saved history sidecar by **feature ID**, not body-list position or approximate face fingerprint. No history sidecar means **copy-only**.
- Requires a stable Reverse document, feature arrays, saved STEP references, body result, CAD build, notes and scan/source bindings. It fails closed if document, source, note store, scan, or workspace changes across asynchronous boundaries.
- Retains the already approved host contract: `reopenAndRestoreSurfaceHistory` authenticates source/result STEP, recipe digest, source body key and independent OCCT replay, then uses the caller's **fresh-session factory** and the plugin's existing `restoreHistoryBundle({recipe,notes},signal)`. No new plugin method or schema.
- Supports only already recognized recipe versions 2–6. Experimental v8 remains disabled and no unknown recipe is interpreted.
- Returns a verified **off-screen** session and an `assertCurrent()` guard for a future host-owned viewport handoff, plus an idempotent `release()` disposal. It never registers the session in the public editor or mutates CAD/history/notes.
- On missing replay, invalid hash/recipe, stale source/notes, missing feature or failed restore: retain authoritative archived CAD and report **copy-only**.

## Local independent QA
Checkout: `D:\TMAR-QA\tmar-host41-parametric-recovery-ab270be-qa-20261107`
Evidence: `D:\TMAR-QA\tmar-host41-parametric-recovery-evidence-20261107`

Host regression `surfaceEditHistoryHost.test.ts` verifies archived feature selection, fresh off-screen session, upstream STEP and recipe content, one release, absent replay rejection, invalid feature ID, and mutation of the host notes store while replay is pending. It must leave CAD unchanged.

`surfaceHistoryCurvedG1Recovery.test.ts` uses a **synthetic three-face open sewn shell**, a native NURBS G1-compatible supporting face, actual v6 recipe creation, independent replay-qualified CAD-copy publication, Reverse section Save/Load, and fresh off-screen re-evaluation through an independent OCCT editor. It is not a closed solid, real scan, real packaged app or general BREP continuity proof.

## Required next gates
1. Confirm the plugin owner accepts the existing v6 `prepareHistoryRecipe` / `freezeHistory` and `restoreHistoryBundle` semantics; do not change them unilaterally.
2. Separately wire a **public Apply** to optional one-use frozen recipe qualification, then publish the source STEP + sidecar atomically with the CAD copy. Ordinary Apply must remain available as CAD-copy and all failures fail closed.
3. Design a user-visible **Reopen Parametric** action and fresh viewport lease installation. At the handoff boundary, recheck `assertCurrent()` synchronously and dispose unused sessions. This code does **not** install it.
4. Real synthetic **closed-solid G1** tests, varied support topology, orientation and pcurve/boundary invariants, dark/hidden references, negative timestamp/hash/epoch/abort cases, project ZIP Save/Load and cold packaged-desktop restart.
5. Fix the existing plugin `workspaceLayer.test.ts` TypeScript TS2540 readonly fixture error independently; do not hide a failing global TypeScript build as a PASS.
6. No PR merge, desktop release, native sewing, shared-plane integration or QuickSurface parity claim.

**Decision: host-only opt-in recovery preparation can be reviewed. End-to-end user-visible editable parametric feature remains HOLD.**
