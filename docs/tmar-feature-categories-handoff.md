<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Category-scoped feature selection — draft handoff

Date: November 2, 2026. Base: `742d91d98b693735be2bafb36ff37b66bfa294c6`.

## User requirement

Separate features by category so selecting/hiding sketches or section profiles
does not also hide the finished body. Preserve working note/feature selection,
large collapse headers, resizable panels, note focus and the latest Zebra.

## Prepared code

The model-tree plugin groups tagged native feature rows into sketches, section
sketches, surface operations, solid-body operations and safe unclassified rows.
Selection/range anchors and collapse state are independent per category.
There is no global mixed-category visibility action. The native Bodies list
remains separate from operation history. Unknown kinds have no visibility action.

The pure resolver filters selected IDs by category again at the write boundary,
then filters actual output bodies by their surface flag. Sketch actions return
no body IDs, even when result metadata references a body. The visibility writer
preserves the original body/hidden-body state references for a sketch-only action.
No geometry, build order, suppression, project schema, notes or Zebra is changed.

The generic adapter collects only explicit FeatureRowExtension nodes inside
fragments/DOM containers. It does not execute components or infer IDs from keys.
The original chronological list remains mounted in Build history / rollback.
An incomplete/duplicate row adapter falls back visibly to that original list.

## Checks actually performed

| Check | Status |
| --- | --- |
| Dependency-free Node tests of classification and target isolation | PASS: 26/26 |
| Strict TypeScript check of featureCategories.ts only | PASS |
| Syntax transpilation of changed TypeScript/TSX sources | PASS (not semantic application checking) |
| New adapter Vitest tests | NOT RUN |
| Complete application type check and production build | NOT RUN |
| Browser interaction, visuals and all existing regressions | NOT RUN |
| macOS / Windows runtime qualification | NOT RUN |
| New preview, release or deployment | NOT DONE |

Environment used for the limited checks: Linux container, Node 22.16.0 and the
container's installed TypeScript. No user project or personal scan was loaded.

The Windows tunnel returned HTTP 409 (MCP not initialized). The alternative
Remote Desktop Commander connection returned HTTP 400 (account connection
failed). Public source-archive retrieval was also unavailable in the local
container. GitHub read/write access remained available. These failures did not
justify claiming a Windows test run, replacing the active preview or merging
unqualified UI changes into main.

## Required safe continuation

1. Check out this branch in an isolated copy after the PC connection is restored.
2. Run the source/build checks listed in the plugin README and the adapter tests.
3. Adapt the INITIAL feature-selection block of
   `plugins/tmar-quick-notes/scripts/e2e-usability.mjs` to the intentional new
   contract. Scope selectors to `[data-feature-category="sketches"]` or
   `[data-feature-category="bodies"]`; do not remove its subsequent export,
   note navigation, provenance or save/reopen assertions. The old expectation
   that one Ctrl+A selects both profiles and body-producing features is obsolete.
4. Verify Ctrl/Cmd/Shift/Select All, retained collapse selections, newly added
   rows, a section-based sketch, suppressed and rolled-back rows, and unknown
   kinds. Select all sketches and hide: every body and all notes must remain.
   Select all body operations and hide: sketch visibility must remain unchanged.
   Verify one Undo, original build order, rollback and playback.
5. Exercise source row editing/delete/suppress controls, long lists, resizable
   panels, viewport labels and project round trips. Review both grouped rows and
   the mounted chronological list for selector/focus conflicts.
6. Run Zebra's 32-assertion workflow, reflection checks, production note-focus
   and the other inherited targeted regressions. The baseline already contains
   PR #6; do not reimplement or cherry-pick it a second time.
7. Only after the gate passes: review/merge, then create a NEW preview including
   categories and Zebra. Preserve sessions/ports 17492–17494. Do not claim that
   an existing page updates automatically when main changes.

Historical PASS counts in earlier documents apply to their recorded revisions,
not this unqualified grouping change. Keep this PR in draft until the above gate
is completed and its validation record is updated with actual results.
