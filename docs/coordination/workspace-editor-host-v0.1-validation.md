<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Workspace editor host v0.1 — qualification record

2026-11-03, Europe/Rome. First runtime block, based on `4a937825508c7a3ae8677821a00ba3b6e87e0873`, developed in the isolated D: worktree on `feat/workspace-editor-host-20261103`. The code does not change `plugins/tmar-edit-surface/**`, main, the integration checkout on C:, user projects or frozen previews. This is not a numbered delivery or a claim of QuickSurface parity.

## Results

| Check | Recorded result |
| --- | --- |
| Whole-application TypeScript noEmit | PASS |
| Complete production Vite build | PASS; large-chunk warnings remain |
| Targeted units and regressions | 74 PASS in 10 files |
| Actual OCCT staging/transaction tests (included above) | 7 PASS |
| Source-browser host workflow | 14 PASS, zero application console errors |
| Plugin-boundary checker | One pre-existing failure, gallery fixture import |
| Author Edit Surface workspace integration | NOT performed |
| Production-browser embedded-controller workflow | NOT performed |

The browser test is `plugins/reverse/scripts/e2e-workspace-editor-host.mjs`. It dynamically installs the explicitly test-only `tests/fixtures/workspaceEditorProbe.ts` controller into the REAL host; the production application does not register or import that fixture. This verifies host infrastructure, not the author's pole-editing controller, D, snap or general geometry workflow.

### Source-browser scenario

A real STEP solid is imported, then the test controller opens in the main workspace. Assertions verify the same canvas, camera and entry pose; a source mask without changed original geometry/selection; contextual parameters/actions/status and an overlay root without a modal. A real mouse drag captures the pointer and blocks Apply. A foreign synthetic pen pointer cannot replace or finish it. Escape before mouseup restores the draft, releases capture and keeps the editor open; the later mouseup does not add history. Toolbar Undo/Redo use the local controller history without touching project history.

Host Apply produces a separate CAD copy and exactly one project Undo action, releases the display mask and removes the overlay. Project toolbar Undo/Redo removes and restores that copy. Another Apply is held **after actual OCCT staging**: Cancel closes the session, then releasing the staged response is rejected without another body/history entry.

The project is saved and loaded in a fresh page. Both reopened bodies are exported via the current-CAD gateway and read independently by Node OCCT. Both are valid six-face solids; volumes are **6000 and 7200 mm³**. These are synthetic box fixtures, not measured scanner accuracy or freeform continuity evidence. The screenshot was visually inspected and explicitly labels the controller as QA, not the completed Edit Surface UI.

### Kernel and race checks

The seven OCCT tests cover unchanged stores/kernel/history during preparation; one atomic copy publication with existing notes retained; idempotent publication and conflicting hash refusal; actual Undo/Redo including STEP resource removal/restoration; project-section serialization/reload; a moved ordinary open sheet; invalid STEP rejection; source change after staging; injected publication observer failure with restoration of CAD maps/kernel/store/history; cancellation; same numeric IDs in a new document; and a document replaced while kernel readiness is still awaiting.

Manager/lifetime tests separately cover Cancel before dispatch, after asynchronous preparation/staging, late initialization, stale source, exact-stamp validation including a committing observer, double Apply, cleanup once, a late fatal callback from a disposed session, and cleanup after initialization failures. Part-space ray/projection tests cover orthographic/perspective cameras and transformed parts. Input-routing tests exercise actual SceneManager methods without creating a WebGL context; the real-browser workflow supplies that separate coverage.

The old modal path using `reverse.import.step` is NOT rewritten by these tests or this host block. The new Apply service avoids that queue, validates after all its waits and publishes synchronously. Do not claim that closing the old modal now cancels a generic import already queued by it.

## Failures retained and corrected

Initial work-in-progress TypeScript checks failed on test mock typing; fixed before the passing run. A first kernel test setup could not resolve a WASM asset through the existing cross-drive node_modules junction. The local QA configuration allows only the worktree and that dependency directory, uses its own D: cache, preserves junction paths and ignores QA output in the watcher. No production server filesystem policy or global settings were relaxed.

Early browser attempts recorded: a watcher error on the owned Chrome profile; kernel initialization not awaited by the test; a development WASM URL returning HTML through the junction; and the test not registering lazy core file commands. Those harness failures remain in the ignored QA output, not relabelled PASS.

A real interaction error occurred when the host's navigation saw a second pointer while the editor captured the first. The host lease now intercepts an accepted pointer before navigation tracks it and blocks foreign events during capture. The complete browser scenario was repeated successfully with its console-error assertion unchanged.

The new E2E script was placed inside the reverse plugin after the boundary checker correctly rejected its plugin imports from the generic scripts folder. No exception was added. The remaining failure is the prior `scripts/capture-tmar-gallery.mjs:11` import of `plugins/tmar-mesh-review/scripts/fixture.mjs`.

## Evidence and reproduction

Published evidence beside this record: `evidence/workspace-editor-host-20261103/` contains the final source-browser result, inspected screenshot and hashes. Full logs, generated projects and exported STEP files remain at `e2e-out/host-editor/` in the D: worktree. Original STEP exports are not whitespace-normalized. Browser profiles and raw delegated-CLI logs are not committed.

Normal-checkout commands:

```sh
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/vite/bin/vite.js build
node node_modules/vitest/vitest.mjs run tests/workspaceEditors.test.ts tests/editorViewportLease.test.ts plugins/reverse/tests/editorRenderMask.test.ts plugins/reverse/tests/workspaceEditorHost.test.ts tests/history.test.ts tests/commandRegistry.test.ts plugins/reverse/tests/reHistory.test.ts plugins/reverse/tests/reBodyEditSource.test.ts plugins/reverse/tests/reBodyEditSourceClient.test.ts plugins/reverse/tests/reProject.test.ts
# Against an isolated source server, with APP_URL and an owned OUT_DIR:
node plugins/reverse/scripts/e2e-workspace-editor-host.mjs
```

For this cross-drive QA worktree the tests/server used an ignored local config for the dependency junction and output watcher. The complete production build used the normal application config, writing only to its new D: output folder. No dependencies were installed.

## Independent-agent status and remaining gates

Two bounded Codex CLI static reviewers were attempted, for transaction/history and viewport/resource ownership, with ephemeral read-only execution and no tool/CAD permission in their prompts. Both failed at startup with `model_not_found`; no review reports were produced. They are not counted as independent approvals. No global CLI/config repair, model installation or sandbox escalation was performed.

The previous unpublished D: host draft was found and backed up before continued implementation. The clean C: integration checkout alone had not shown this WIP. The recovered draft's old test failures were not mistaken for successful qualification.

Remaining: author controller/layer integration and its compiled UI tests; annotation transaction and persistent face binding; parametric recipe/history; layout A/B/C and timeline; categorized Settings and tooltip timing; Patch Network normal movement; preview Zebra/CAD-edge/clipping combinations; all navigation schemes/touch; large datasets and graph rebuild costs; macOS/desktop package; automatic recovery. Current tests do not close those requirements. User Versione 1, author worktrees and CAD sessions are unchanged.
