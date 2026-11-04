<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Exact integration 5f39ff5: compiled annotated Apply qualification

4 November 2026, Europe/Rome. Isolated integration and bounded QA; no main merge, deployment, numbered preview update or release.

## Published runtime integration

- Host parent: `5684f5f27eaaa6ee460eef2300b010eb622b4507` (PR #22).
- Author plugin: `324a2e00bfd35c40d86e199015ea7718c2e946b7`.
- Plugin subtree: `48d9da15efc45d172e1f93a384315717fcbaccb0`.
- Runtime integration: `5f39ff521d0095e01fb9b7f1a5af833bca9e28ba`.
- Integration branch: `integration/host5684-plugin324a2e0-20261104` (PR #23, DRAFT).

The integration commit selectively imports the exact plugin subtree. It changes no file outside `plugins/tmar-edit-surface/**` relative to its host parent, and is not a whole-branch merge of unrelated author changes. No production edits were added to either side to make the tests pass. Host API, dependency lock, version badge and original host/plugin branches are unchanged by this task. All tracked runtime hashes are compared again after the tests; `final-integrity.json` reports no changes.

The separate review branch contains only the QA harness, read-only-permission Actions workflow and this report in addition to the integration base. It must not be mistaken for a new host runtime. Windows worktrees, user projects and active CAD sessions were not accessed.

## Completed runs

Successful Actions run: `41747790210`, job `126305042651`.
QA workflow revision: `0e50b929fc191f87b5f72d4fec3d2d9f0844abae`.
Environment: Ubuntu 24.04, Chrome, Node 22.18.0, locked dependencies, occt-wasm 5.7.1.

| Check | Result |
| --- | --- |
| Exact integration ancestry/subtree and tracked source hashes | PASS |
| TypeScript and full production build | PASS |
| Targeted host/plugin regressions | 155 PASS across 8 files |
| Source UI, guarded viewport face switching | 15 PASS |
| Full compiled UI, fresh STEP through annotated Apply and native roundtrip | 16 PASS |
| Application console errors in both completed browser scenarios | Zero |
| Final tracked runtime integrity | Unchanged |

The 155 tests are history (13), workspaceEditors (29), annotatedCopy (16), annotatedNormal.qa (1), mixed-support-step (12), note-orientation (2), workspaceLayer (34) and workspaceSession (48). This is targeted coverage, not an assertion that the entire repository suite or default CI is green. Inherited production-build warnings do not constitute desktop qualification.

## Full compiled cycle: what was actually driven

This closes the previously open compiled-Apply gap for the bounded synthetic case below. It is not merely loading a project annotated in a source app.

`compiled-full/result.json` starts with a newly generated 20 x 30 x 10 mm STEP box, a clean QA browser profile and no pre-existing notes. The browser serves ordinary production build assets through Vite preview on an owned loopback port. It does not import source modules, inject a controller, call application stores or dispatch private app commands.

Through the UI the test imports STEP, opens Edit Surface in the existing canvas, clicks an editable face, activates Zebra, mouse-places a new note and types its text. With the note present it checks that a face change is rejected without losing the note/face, and that local STEP export remains disabled rather than silently discarding the note. It selects free poles, enters 0.05 mm along Local N, deforms and clicks the host Apply button.

The newly saved native project contains the preserved original, one geometrically changed copy and the verified note. The original is hidden and the copy is visible. One toolbar Undo removes copy and note and restores the original's visibility; one toolbar Redo restores both with unchanged note UUID, feature UUID and body association. Native files are saved at baseline, applied, undone, redone and freshly reopened stages, in separate owned download directories.

A fresh compiled page loads the redone project and saves it again. The archive checks assert exact note/feature/body identity, text, verified status, position, face-oriented normal and separate witness/destination UV records. Node-side OCCT independently reads the saved witness and STEP, checks the signed normal and valid CAD, and later reimports the actual two-body UI export.

This compiled scenario selected face index 5 of its synthetic box; its witnessed orientation is **forward**, not reversed. The reversed-face accept/reject regression remains in the real-OCCT targeted tests; this report does not re-label those as a second compiled reversed-face UI run.

Measured OCCT volumes after export: original `6000 mm³`, edited copy `6001.875048749859 mm³`, both valid solids. These are measured consistency results for this case, not a universal proof of exact mass integration or arbitrary surface conversion.

Identity in the final run:

- Note UUID: `dcf1bc56-0af1-45df-b1ef-4134d4daa4d4`.
- Feature UUID: `4c9a4887-06d9-4f26-8f0c-257f8ef9fa17`.
- Body ID: `2`.
- Operation ID: `96f3ae2d-db1c-4bde-b918-0561e4b0efc7`.

Selected file SHA256 values:

- Applied native project: `0f3c39c4b1b80dd47033a0c8aa1fb60324525d7d239a937537a9489d6e34c123`.
- Redone native project: `b9124b3bf020be5df4d55510ed23b5a24a9ef89b5aa365bcfcaf0edcca65655e`.
- Reopened/resaved native project: `a039a8ad5edb06cc11d7173e10dc52194f9b44f79e746b51bb3bb1a6bbfe5c02`.
- Exported STEP: `7eacfd1678c28565bea8cf17618236a55282dca085e241cda0e3abaffada0557`.

All recorded file digests were recalculated after artifact download. Synthetic source STEP bytes are unchanged. Screenshots of the editor and reopened note were inspected; the inherited support card and Versione 1 badge visible in them do not indicate a deployed user update.

## New face-switch increment

Source output `source-face-switch/run-q5jAlA/` reruns the author's TEST_FACE_SWITCH scenario against the exact integration. Real viewport clicks switch faces; declining the discard prompt preserves the modified draft; confirming selects the requested face. Numeric movement, actual pointer drag, local Undo/Redo, Apply and independent valid STEP reimport also pass. This source script has explicit internal observations, unlike the public-UI-only compiled scenario; their scopes are kept distinct.

Failed face-load preservation and pending-calculation protection are covered in targeted session tests, not claimed as new compiled pointer scenarios. Draft-note blocking is additionally checked in the compiled UI scenario described above.

## Initial QA failure retained

Initial run `41747100240`, tooling `f43c28029b0cfb2f119c74e6d87fb24bf0e2baef`, passed unit/build, the 15 source checks and the first eight compiled checks, including actual annotated Apply. It then failed in the test while reading `undone.manifest.reverse.hiddenBodies.includes(...)`.

Inspection of the saved Undo file showed one original feature, no notes and an omitted empty hiddenBodies field. The app serializer legitimately omits the empty collection. Only the QA reader was corrected to `(hiddenBodies ?? []).includes(...)`; all body/note/history/visibility and geometry assertions remain. The workflow asserts the exact one-line substitution and records both script hashes. There is no production patch or relaxed geometry tolerance.

Original script SHA256: `e9a4ff93cfbd9b5c25bae0ddacc2a66cdd82eee430334de7111b9065874a580c`.
Executed corrected script SHA256: `4888869945e645ea57854901218f68dd6c034336736e16dd3128859291bb5ba9`.
The exact executed script is included as `executed-compiled-test.mjs` in the artifact. The initial run was not deleted or relabelled PASS.

## Contract and prerequisites

No additional host API or plugin adapter change is needed for this integration. The existing sources remain authoritative:

- `src/plugins/annotatedCopyTypes.ts`
- `src/plugins/workspaceEditorTypes.ts`
- `src/plugins/workspaceEditors.ts`

Capability remains API 1, annotationVersion 1, commitKinds cad-copy and annotated-cad-copy. `freezeAnnotated`, `prepareAnnotatedApply` and monotonically changing `notesRevision` remain required. All draft notes are prepared with the final geometry and one verified face witness; no plain-copy fallback drops notes. Source guards, coordinated publication, source hiding and note revalidation stay enabled. This is not parametric surfaceEdit recipe persistence.

No missing prerequisite blocked this isolated Linux/web qualification. Desktop deployment, broader release approval and remaining product work are different gates.

## Cylinders and other limits

The author's later cylinder conversion study is NOT included in plugin 324a2e0 or this integration. Cylinder editing remains disabled. The reported discrepancy between coincident surface/boundary samples and OCCT volume remains unclassified; pcurves are not qualified.

Open-Cascade-SAS/OCCT issue #1675 was read as a possible numerical-integration lead. It is not proof that the same issue causes the author's cylinder discrepancy, and no upstream patch/workaround, normal-sign change, tolerance relaxation or mass override was applied here. The box roundtrip above does not settle that investigation.

No new claims of general topology/periodic/cylinder editing, arbitrary trim coverage, large-model performance, desktop/macOS qualification, metrological mass correctness or QuickSurface parity. No independent subagent endorsement. Patch Network 3D movement, settings/tooltips and A/B/C layout/timeline remain separate and were not advanced by this delivery. The legacy modal import race remains distinct from the workspace path.

## Evidence and delivery

Final artifact `13283244553`, `compiled-annotated-324a2e0-review`, 20 members:
SHA256 `f3095266aeb1d6b7b6bdd52bad79fa2bac757a4159fb73edea58fe95579828ea`.
Initial artifact `13283134194`:
SHA256 `23df582e43fdd694b3547f09fd28e3b19b497695d60266b3d0b6c6bdbd22832c`.
ZIP digest and member CRC checks pass. Artifacts contain bounded results, source hashes, screenshots, synthetic geometry/native projects and the executed QA script, not credentials or browser profiles.

PR #23 remains DRAFT on runtime 5f39ff5. Host 5684f5f and author branch are not moved. No main merge, release, runtime deployment, Windows session access or Versione 2 was performed.
