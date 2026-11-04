<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Exact published host 5684f5f + plugin 3bed36f: isolated pairing review

4 November 2026, Europe/Rome. Runs occurred late 3 November UTC, after midnight in Italy. **Review evidence only: no runtime integration commit, merge, release, numbered preview or desktop qualification.**

## Immutable pair and ownership

- Host: `5684f5f27eaaa6ee460eef2300b010eb622b4507`, published PR #22.
- Plugin: `3bed36f70167b350b87a6615ff22a79dfa6da9e3`, author branch codex/edit-surface.
- Successful QA tooling revision: `09d9326e4f4fc24617b0c62cd7432169692fec88` on `review/host5684-plugin3bed36f-20261104`.
- Successful Actions run: `41742918966`, job `126288646531`.
- Runtime: Ubuntu 24.04, Chrome, Node 22.18.0, locked dependencies, occt-wasm 5.7.1.

The runner checks out those exact host/plugin commits separately and replaces only the named plugin directory in its ephemeral QA checkout. No host or plugin production patch is applied. Snapshot hashes cover 1,061 host src/plugins files outside Edit Surface and 311 plugin files; the final check confirms all are unchanged. Additional scripts are test-only. The review branch contains only QA scripts, its read-only-permission Actions workflow and this record. The host branch remains at 5684f5f; frozen a28c747/64af91e/27c75c3, author worktrees, Windows CAD sessions, main and Versione 1 were not modified by this task.

This paired execution is not a cherry-pick of the author branch into the host and does not move either operational ref.

## Scope of the plugin delta

Compared with plugin 130d12bf, the change is limited to five plugin files: BREP parser, mixed-support tests, annotated/snap test scripts and integration documentation. The host contract did not change.

The parser can preserve solids containing spline extrusion/revolution supports while editing another eligible face. **Those curved support faces do not become editable.** This is not cylinder/periodic/general-trim editing or proof of arbitrary BREP coverage. The existing mixed-support tests exercise eligible-plane edits, preservation of adjacent support and valid STEP reimport for two synthetic solids, plus malformed-record rejection cases.

## Results actually obtained

| Check | Result |
| --- | --- |
| Exact paired TypeScript | PASS |
| Full paired production build | PASS; inherited browser-externalization/large-bundle warnings |
| Affected host/plugin tests | 76 PASS across 5 files |
| Real annotated source controller, reversed box face | 14 PASS |
| Source UI, eligible face next to synthetic spline extrusion | 12 PASS |
| Public compiled UI, native note load/resave/fresh-page reload/export | 10 PASS |
| Final host/plugin production file hashes | Unchanged |
| Application console errors in the three completed browser scenarios | Zero |

The 76 tests comprise annotatedCopy (16), annotatedNormal.qa (1), mixed-support-step (12), note-orientation (2), workspaceSession (45). These counts are not a claim that the entire repository suite or default CI is green. Unchanged suites were not indiscriminately repeated.

### Real source-controller annotated flow

Output: `source-annotated/annotated-edit-zwcsaE/`.

The actual plugin controller loads a synthetic STEP box, selects a reversed face, enables Zebra, creates a note through the controller, deforms the face numerically and uses host Apply. It verifies one annotated history action, preserved/hidden original, copy/note, project Undo/Redo, native Save and fresh-page Load. Receipt note UUID, feature UUID and body ID are used for the asynchronous identity wait. Note text, verified face attachment and oriented normal survive; independent CAD reimport remains valid. This is not a new mouse-note-pick qualification.

Native project SHA256:
`a82c30e1ff8e0231c3f166137e17a6dd14c549b607c966ddb3d26937c23dc2a0`

Note UUID: `4f7cad8b-8c16-45f3-9a8f-8785d2f941a5`.
Feature UUID: `d6d07024-5f17-40ec-ad02-91cc601b4215`.
Receipt body ID: `2`.
Original/copy volumes: `6000 / 5999.062475625071 mm³`.

The source script's historical scope string mentions an experimental patched host; in this run there is NO host patch. The immutable checkout and source-hash manifest identify the actual published host used.

### Mixed support in the main view

Output: `source-mixed/run-PrbGOB/`. The input is generated solely by the checked-in review fixture generator, not an operator/user file, although the generic test's STEP_FILE path labels it as operator STEP.

Numeric normal movement, real pointer drag, local Undo/Redo, Apply, shared camera/canvas, cleanup and independent original/copy STEP validation pass. Both are valid six-face solids; final volumes are `1050.9999999999998 / 1050.8295465373817 mm³`. The input bytes are unchanged (SHA256 `8c3237f6f9618384af026361c277e4e0961c16b42823a08cd2000b354741c249`). The browser case covers extrusion; revolution preservation is covered by the real kernel test, not a separate browser run.

### Exact compiled native-note persistence

Output: `compiled-notes/`. The ordinary production build serves through Vite preview. No source-module imports or injected controller are used in the browser.

It loads the NEW project produced by the source run above, saves it, verifies exact UUID/feature/body/text/status and both UV records in the actual ZIP, independently checks position and signed normal against the BREP witness, opens the resaved file in a fresh page, saves again and checks the same identity. It then shows the original only after verifying preserved hidden-source state and exports both bodies. Independent OCCT confirms two valid solids with the source-run volumes. Input project bytes remain unchanged.

First compiled resave SHA256:
`6885c8619a475e1a650b7e99a7fecdb0121799e4606a99e3abc958e2b150a3e8`

Second compiled resave SHA256:
`606864a682b7e69e81691875393dfd10f6d3f6302529e62e064e2691dac4c2ca`

**This qualifies native load/resave/reload/export for this exact pair. It does NOT exercise the complete annotated Apply path in the compiled browser.** The compiled screenshot was captured while a loading overlay was still present; it is retained as an intermediate frame, not used as proof of a fully settled view. The later enabled-Save gate, actual files and independent readback establish the persistence checks.

## Initial failure preserved, not hidden

Initial run `41741711310`, tooling `09bb6a7ff39100e24d3f76b04ba83668b3f071a8`, passed the 76 tests, source 14/12 checks and first five compiled checks, then timed out waiting for a second .scanruler filename. Its artifact contains a new `project.scanruler` hash (`ffe2cced43ab13de7dd6f8c26292ab3fc4c6b62c5571b35bc61832501e8b4bb7`) different from the first save recorded by the test (`288520b75d6b17ce8dba5d20d8893cb866ea40cd78eb61c2e0053533c4c037f0`), with the same verified note. The second save had overwritten the same suggested filename; the test's new-filename-only waiter was wrong.

Only the QA harness was corrected: the second save/download gets a separate owned directory, retaining both files and all original identity/geometry assertions. Node was also raised from 22.16.0 to 22.18.0 to meet meshstep's declared engine requirement; that warning was not the download failure's cause. No production workaround or assertion weakening was introduced. The final complete run passes.

## Evidence identifiers

Initial artifact `13281183194`, ZIP SHA256:
`c5688a3eaaf0cc7a5cb4f6e71670ea3ae754022ee367f0207802af50acc4b47c`.

Final artifact `13281573115`, name `host5684-plugin3bed-review`, 19 members, ZIP SHA256:
`510827b6ec446de68c0370fbcd63d9c3780595688184d6fa060e21e9bb7be80f`.

Both ZIP hashes/CRCs were checked after transfer into the review container. Results, native archive note attachments and selected screenshots were inspected. No browser profiles, credentials or user geometry are included in these artifacts.

## Contract and remaining limits

The host revision is STILL 5684f5f. QA 09d9326 is NOT a new runtime host. Existing files `src/plugins/annotatedCopyTypes.ts`, `workspaceEditorTypes.ts`, `workspaceEditors.ts` remain the integration contract: API1, annotationVersion1, cad-copy/annotated-cad-copy, optional freezeAnnotated/prepareAnnotatedApply and notesRevision. No adapter signature change is required for 3bed36f. Full note bundle, oriented-normal validation, source guards, source hiding and native face revalidation remain in force.

The author's e66be82 Local N/Screen snapping results were read and remain author evidence here; those pointer cases were not rerun in this review. No claim of compiled annotated Apply, broad real-project/Lego/general topology coverage, cylinder editing, exact BREP snapping, packaged desktop/macOS, large-model performance or QuickSurface parity. No independent subagent endorsement is claimed.

Patch Network's 3D movement, layout/timeline and Settings/tooltips remain separate, unadvanced by this pairing. No merge, runtime deployment, release or Versione 2 was performed.
