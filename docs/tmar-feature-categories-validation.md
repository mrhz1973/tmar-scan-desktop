<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Category-scoped features - integration validation

Verified November 2, 2026. Base: `742d91d98b693735be2bafb36ff37b66bfa294c6`.
Tested source: `86b48bb488bf91b562cbb12390bf215dd14d821f`. PR #7, `feat/category-scoped-features-20261102`.
Documentation accompanying this record does not change the tested application.

## Delivered contract

Each feature category owns its selection, range anchor, Select All, Show/Hide and
large collapse header. Ordinary sketches and section sketches cannot target body
visibility. Surface operations cannot hide solids; solid operations cannot hide
surface outputs or sketches. The resolver filters stale/mixed IDs again at the
write boundary, deduplicates shared outputs, and refuses unclassified categories.
Actual Bodies/components remain in the existing list. No geometry or project
schema changes. The full chronological list remains mounted behind its own
Build history / rollback disclosure; it drives rollback and playback in original
order. Grouped rows reuse tagged native components and their explicit buttons;
right-click history menus remain scoped to the original chronological area.

The production check found an additional issue: saving uses the same queue as
imports, and the generic selection hook reset on any queue activity. It now resets
on committed history revision (replacement or Undo/Redo), not Save Project. Both
feature-category and note selections survive a save; opening the same project
still clears them. Invalid/removed IDs are still pruned.

The only shared runtime changes beyond the model-tree plugin are the explicit
feature-row adapter in `plugins/reverse/app/listExtensions.tsx` and that generic
selection hook in `src/plugins/listSelection.ts`. No Zebra, note anchoring,
shader, kernel, source geometry, dependency manifest or credential was changed.
Zebra PR #6 is already in the base and has not been reapplied.

## Actual local checks

Windows ASUSDESKTOP, Node 26.8.1, Chrome 156.0.8078.74. Generated geometry and
owned profiles only. No active user project or personal scan was opened.

- 26 dependency-free resolver checks passed, including known operation kinds,
  wrong-category/stale IDs, shared bodies, suppressed rows and non-mutation.
- 75 targeted Vitest tests passed across 13 files, including adapter traversal
  and direct visibility writes with preserved body and note identities.
- Complete TypeScript check and production build passed.
- Plugin boundary, display-unit and whitespace checks passed.
- Actual WebGL before/current reflection checks passed with integrated Zebra.

| Browser scenario | Result |
| --- | --- |
| categories | 35 assertions, exit 0 |
| zebra | 32 assertions, exit 0 |
| usability | 40 assertions, exit 0 |
| tmar-web | 15 assertions, exit 0 |
| reverse-notes | 54 assertions, exit 0 |
| note-provenance | 22 assertions, exit 0 |
| category-production | 22 assertions, exit 0 |
| focus-production | 31 assertions, exit 0 |
| production | 9 assertions, exit 0 |

Total: **260 application-browser assertions**, all final scenarios exit 0.
No application console errors. Repeated development/review/preview reruns are
not added to that total. Existing build/module-size, Node localStorage and
Windows temporary-profile cleanup warnings are non-blocking and not concealed.
These are local results, not a claim that GitHub-hosted checks ran successfully.

Category coverage includes sketches, section sketches, sheets and solid bodies;
Ctrl/Cmd/Shift/Select All across forty off-screen profiles; preserved collapsed
selection; independently hidden categories; notes/source sections unchanged;
Undo; native edit/cancel/delete/suppress/restore; rollback/playback; new AI-like
rows not joining existing selections; and actual project save/reopen.

The production scenario uses only the compiled UI and inspects real downloaded
`.scanruler` archives. It checks body eyes and saved hidden-body IDs, typed
category writes, Save Project selection retention, replacement clearing,
Zebra and note-focus compatibility, and persisted collapse preferences.
Inherited regressions retain actual STEP/STL downloads, note shortcuts/focus,
labels, large disclosure headers, panel resizing and imported-note provenance.

## Reproduction

```sh
npm ci
npm --prefix mcp ci
node --experimental-strip-types --test plugins/tmar-model-tree/scripts/check-categories.mjs
npx vitest run tests/listSelection.test.ts tests/panelExtensions.test.ts plugins/tmar-quick-notes/tests plugins/tmar-display-controls/tests plugins/tmar-model-tree/tests plugins/tmar-body-export/tests plugins/tmar-zebra/tests plugins/reverse/tests/reNotes.test.ts plugins/reverse/tests/reNoteCommands.test.ts --maxWorkers=2 --minWorkers=1
npm run build
node plugins/tmar-model-tree/scripts/e2e-categories.mjs
node plugins/tmar-model-tree/scripts/e2e-categories-production.mjs
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
node plugins/tmar-quick-notes/scripts/e2e-focus-production.mjs
node plugins/tmar-zebra/scripts/e2e-zebra.mjs
node plugins/tmar-zebra/scripts/check-reflection.mjs
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

The category dev script generates the synthetic fixture required by its production
counterpart. Production scripts need a compiled `dist/`; APP_URL, when supplied,
must point at the appropriate dev/production server. Always launch an owned
profile; never run fixture replacement against a user's active tab.

## Intermediate failures and limitations

The interrupted draft did not run the application. Its `.test.tsx` adapter file
was not discovered by the existing `.test.ts` Vitest include; it was rewritten
with explicit React element construction in `.test.ts` and actually executed.
The first category browser run serialized a typed-array project result incorrectly;
converting it to an array before transferring out of the browser fixed the harness.
The first production run then exposed the real save-clears-selection defect.
The hook was corrected; assertions were retained and expanded, not loosened.
The expanded suppression scenario also required its range-selection assertion
to compare the other category with its previous selection, not assume it was
empty: category selections are intentionally independent. These intermediate
failed attempts are not counted as passing final checks.

Not qualified: a real scan/large production project, macOS, native touch/Cmd-click,
Safari/Firefox, the desktop package, complete upstream suite or performance gains.
The groups classify feature records, not every measured construction entity,
source section or saved face selection. A consumed operation may have no independent
compatible output; use Bodies for actual final solids/sheets. Hiding is neither
suppression nor deletion. Category grouping itself does not change geometric quality.
The existing Zebra synthetic sphere/torus comparison remains bounded and is not
universal QS parity. No release or live-session replacement was part of validation.
