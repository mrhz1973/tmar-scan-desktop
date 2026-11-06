# TMAR ScanRuler — Host history freeze and annotated-note save timing

**Data:** 6 novembre 2026 · **Stato:** preflight host-only, Draft/HOLD, no release.

## Provenienza e ownership

- Parent host: PR #35, commit `a3a1498f0cf49df18743a020a496fded25cd9bfc`.
- Plugin checkpoint `2e8d431095baf60ae249185a00943cb29b257950` (includes earlier `d3db206b38eda285b381a986bba5bf4bdbc4f25e`). Verified plugin subtree `f69647b6a1d6a643f8592d6a2049de406c0c0997`.
- The host owns `plugins/reverse/**`, `src/app/**`, and these docs. The author owns `plugins/tmar-edit-surface/**`: **none of those files are included in the host PR**.
- Exact paired worktree `D:\TMAR-QA\tmar-host35-freeze2e8-qualified-qa-20261106`; independent Chrome browser profiles and isolated test projects; no operator CAD session touched.

## New freeze: contract used by host opt-in history

- Plugin contract from `RECIPE-INTEGRATION.md`: `freezeHistory(prepared)` synchronously refuses copied/stale preparations and competing edits; returns immutable `{isCurrent(),release()}`. The preparation must be revalidated before freeze. A freeze does **not** authenticate a recipe on its own.
- `withFrozenHistoryTransaction(owner,prepared,operation)` invokes the plugin freeze synchronously, passes a one-use host bind token, and **always** releases in `finally`.
- `qualifySurfaceHistory` / `qualifyAnnotatedSurfaceHistory` must independently replay and compare upstream/result CAD and (if annotated) ticket/UV/face witness before a qualified token is bound to the freeze. A bare JSON or replay success flag does not authorize host publication.
- `stageEditorCopy(..., qualifiedHistory)` now **rejects missing/expired freeze**. Its `alive` function checks the lock after every candidate-kernel async boundary, and the callback inside the existing synchronous `historyAtomic` rechecks `isCurrent()` immediately before state mutations. No new mutation path or merged state is introduced.
- Undo/Redo and the existing CAD-copy/cad-copy-annotated publication are unchanged when no history token is present. This path remains opt-in and is **not** connected to the public workspace UI or a rebuild-time `surfaceEdit` feature.
- A revocation simulated **after** candidate staging but **before** `publish` is refused with no new history step. An injected asynchronous error still executes lock.release(). Host unit tests use a fake freeze lease at the stage boundary; plugin Vitest and real browser UI separately exercise the actual `2e8d431` freeze API.

## Zebra note save-timing defect: reproduced and contained

- Previous exact host PR35 + plugin `2e8d431` compiled Vite app, click-to-place Zebra note, synthetic STEP: **9/9 PASS**, yet project ZIP held `reverseNotes.notes[].attachment.status='unresolved'` when Save was clicked immediately after Apply. On reopening, the attachment was revalidated. Baseline: `D:\TMAR-QA\host35-freeze2e8-note-save-evidence-20261106\baseline\compiled-QOKfb0\result.json`.
- Cause: `watchAnnotations` temporarily sets verified attachments to unresolved while asynchronous OCCT `revalidateAnnotations()` is pending; `packProject` previously captured project data before awaiting it.
- Host `ProjectSection.beforeSave?()` is an optional asynchronous pre-collection hook. `useProject.packProject()` awaits the hooks and rechecks editor inactivity just before synchronous `collectProject`.
- `reverseNotes.beforeSave` yields to queued microtasks and explicitly revalidates current attachments; no status is forcibly changed to verified. An actual invalid/broken note persists as unresolved, retaining safety. A revalidation-kernel exception cannot prevent emergency project saving: the attachment is marked unresolved rather than falsely verified, and Save Project shows an explicit note-revalidation warning. Other section collect methods remain synchronous.
- **Production compiled UI repeat 1:** strict assertion that saved ZIP status is **verified**, full Apply/Save/Reopen/STEP smoke **9/9 PASS**; `after-host-save-gate\compiled-LIdsl9\result.json`.
- **Production compiled UI repeat 2:** same strict test, saved status **verified**, **9/9 PASS**; `repeat-2\compiled-X4BdL6\result.json`.
- Tests exercise an actual Chrome mouse click on the compiled viewport but a **synthetic STEP**, not the operator's installed desktop build. Browser profiles and files reside only in QA evidence paths.

## Real owner STEP / real plugin freeze

- `lego mod qs.stp` read-only; 398720 bytes; source SHA-256 `f47e9d2ff01ed35f392c762edd860fba5b6c90514de68d9cbc29951537931243` unchanged.
- Actual Edit Surface controller + OCCT worker, face 19/body `1.0009765625`, Zebra note: prepareAnnotatedHistory, wait current, freezeHistory, attempt competing edit (refused), check lock.isCurrent, release twice idempotently, then ordinary annotated CAD-copy Apply, file Save/Reopen and validated STEP: **20/20 PASS**. Evidence `real-LEGO-freeze\run-XTQUnJ\result.json`. Test uses source-app isolated browser (not installed build); actual history publication is still **not** wired into UI.
- Tests for host freeze guard, release-on-failure, note Save, real OCCT validated history publication, Undo/Redo, preserving cad-copy are in `surfaceEditHistoryHost.test.ts`, `surfaceEditAnnotatedHistoryHost.test.ts`, `surfaceEditHistoryContract.test.ts`, `annotatedCopy.test.ts`.

## Open gates / product contract

1. **No surfaceEdit feature graph** yet: optional `ImportFeature.surfaceEditHistory` metadata remains inert. A proper feature must rebuild from archived upstream STEP, with stale source and topology handling and independent replay, before users can edit an old recipe.
2. **No public UI host history command yet:** the plugin freeze, host replay, stage and commit adapters need an orchestrated action with abort/cancel/fatal disposal and ownership/lease management. The QA browser test confirms plugin freeze separately; its Apply is deliberately cad-copy.
3. **Note integrity and orphan handling:** save revalidation now avoids the observed transient unresolved snapshot; genuine mismatches remain unresolved. Still requires review for concurrent rebuilds, failure injection and larger projects.
4. **Release gates remain:** installed Windows/macOS packaged app, real user hardware, large scanned meshes and complex trimmed/curved/G1 features, full QuickSurface parity, CI, independent code review.
5. Keep PR #31–#35 unchanged and in Draft; this host child PR is Draft too. **NO MERGE / NO DEPLOY / NO RELEASE**.

## Source of truth
- Host PR #35: https://github.com/mrhz1973/tmar-scan-desktop/pull/35
- Plugin freeze: https://github.com/mrhz1973/tmar-scan-desktop/commit/2e8d431095baf60ae249185a00943cb29b257950
- Compiled Zebra click test: https://github.com/mrhz1973/tmar-scan-desktop/commit/d3db206b38eda285b381a986bba5bf4bdbc4f25e
