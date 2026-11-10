<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Embedding contract v0.1 — scope and review receipt

2026-11-03, Europe/Rome. **Design publication only. No host editor API implemented, no UI delivery, no plugin acquisition or CAD runtime test in this increment.**

## Repository scope

The inspected integration baseline is `39e92174927ebe43fcab409f03fb78ab470e89da`, branch `review/edit-surface-integration-20261103`, PR14 draft. This publication adds only the contract, its type-only declaration companion and this receipt under `docs/coordination/`. No runtime source, author worktree or numbered manifest is modified. Versione 1 remains the frozen `e9058d6` snapshot at port 17503.

The author chain `5899391 → 63cbe44 → f993820cf57ccaeab63172e1d1843d1021575fc1` was read remotely. At that pinned revision, `evidence/snap/free-boundary-compiled.json` reports one valid B-spline face, actual pointer drag and Undo/Redo; `escape-handle-compiled.json` reports direct D, cancellation, Escape, pending protection, a three-face chain and two shared edges with no recorded console errors. These are **author reports**, not this coordinator's reruns. This contract does not close integrated acceptance of those fixes or claim QS equivalence.

## Direct source review

Inspected existing host facilities: `src/plugins/api.ts`, `src/plugins/panelExtensions.tsx`, `src/viewer/sceneLayers.ts`, camera methods in `src/viewer/SceneManager.ts`, `src/state/historyStore.ts`, command activity and plugin registration, plus `plugins/reverse/EDITOR-SOURCE.md` and plugin `RECIPE-INTEGRATION.md`.

The contract explicitly handles:
- main OrthographicCamera versus the prototype's separate PerspectiveCamera/renderer;
- current prop-less panel extensions versus the proposed session-aware outlets;
- historyBlocked evaluated before local history, so whole-session blocking would disable local toolbar Undo;
- historyAsync's finally recording, which is not transactional rollback;
- part-frame mm, current source identity, late-result suppression, borrowed resource ownership;
- failed initialization cleanup, pointer capture, D versus net, locked/mode local history;
- exact-state freeze/preparation, idempotent staged commit, unsupported notes/parametric payloads, camera/visibility preservation.

These are design requirements derived from the inspected code, not evidence that the missing adapter already behaves this way.

## Lightweight declaration verification

The standalone `.types.d.ts` companion was checked by the repository's installed TypeScript with strict/noEmit, ES2022+DOM and no automatically included types. It has no runtime implementation and uses generic types for the future host camera/group/geometry/layer bindings.

A separate scratch type probe checked a valid SourceBinding/PreviewStamp/ApplyTicket/PreparedCadCopy and five expected type errors: non-mm source units; nonzero notes in a bare-copy payload; valid status without a stamp; parametric mode in the initial copy ticket; and missing documentEpoch. **Static check passed.** No whole-application TypeScript run, production build, WebGL, OCCT, browser, Apply or save/reopen qualification was performed.

## Delegated-review attempt — failed, no endorsement

Two bounded Codex CLI invocations were attempted, for architecture and QA/lifecycle. They received only the proposed contract and selected source excerpts, with explicit no-tools/no-CAD instructions, ephemeral execution and read-only sandbox. They ran in a task-specific scratch directory on D:. They were separate CLI reviewer attempts, not native subagents spawned by this ChatGPT runtime.

Both exited with code 1 before producing a review. The returned error was `model_not_found`: the client's selected `gpt-5.5` model was rejected for the ChatGPT account. Startup also reported a model-catalog parser mismatch on reasoning effort `max`; some automatic connector handshakes requested authentication. There were **no successful reviewer reports and no tool-call items in the returned event streams**. Do not count this as two completed independent reviews. No update, global config repair, credential extraction, sandbox escalation or cache deletion was attempted.

The sanitized delegation summary and prompts remain in `D:\TMAR-QA\workspace-editor-contract-20261103\`; raw CLI logs are not committed. The review checkout was checked clean before/after these attempts.

## Resource and live-session safety

Read-only disk snapshot at 2026-11-03 14:59:27 +01:00: C: **9.524 GiB** free; D: **88.855 GiB** free. The earlier 300 MB warning is not the latest measurement. No disk cleanup or attribution of recovery is made. Only small contract/probe/log artifacts were written on D:, plus the three published documentation files in the coordinator checkout.

No author server 17531, active CAD/QuickSurface session, user project, existing preview, or Settings/Patch Network work-in-progress was used or modified. Patch Network and host/layout ownership remain with the coordinator; Edit Surface controller/scene-layer adaptation remains with the author. All proposed runtime acceptance gates stay open until implemented and tested in an isolated environment.
