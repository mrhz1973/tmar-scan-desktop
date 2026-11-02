<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR categorized feature selection

**Web implementation qualified on Windows/Chrome with synthetic fixtures.**
The baseline is `742d91d`, including the integrated Zebra reflection improvement
from PR #6. Zebra source is unchanged. No native desktop release or real-scan /
macOS qualification is implied.

## Categories, not one mixed Select All

The feature list offers independent collapsible groups:

- **Sketches / profiles**: ordinary, fitted and face-based sketches.
- **Sketches from sections**: sketches whose saved plane refers to a section.
- **Surface operations**: sheet, fitted-surface and patch-network features.
- **Solid-body operations**: recognized solid-making/modifying operations.
- **Other features**: unknown kinds, without bulk visibility permissions.

These classify actual feature records, not words in AI-generated names. They
are not saved surface selections or a new list of every measured construction
element. The existing **Bodies** list remains the source of actual current
solid/surface bodies and its own body/component selection. A feature may share
its current output body with other operations; it is not another body.

Each category owns its Ctrl/Cmd selection, Shift range anchor, Select All,
Clear, Show selected and Hide selected. Focused Ctrl/Cmd+A selects only that
category. Collapsing preserves its selection; new features do not join an
existing selection. No mixed-category Select All/Hide toolbar is exposed.

## Visibility boundary

Sketch actions change only sketch visibility: current bodies, their hidden-ID
list and the source sections are not changed. Surface actions can change only
currently available surface outputs. Solid-body operations can change only
currently available non-surface body outputs. A surface feature that became a
solid cannot hide that solid through the surface group; use Bodies instead.

The action rechecks category membership and output type, even if callers supply
stale or mixed IDs. Suppressed, rolled-back, consumed or incompatible outputs
are skipped and counted. Shared body IDs are deduplicated. Unknown feature
kinds do not acquire permission to hide bodies. One action remains one history
step, and no feature is suppressed, deleted, rebuilt or reordered by Show/Hide.

## Preserve native controls and chronology

The generic list adapter exposes only explicitly tagged native feature rows.
Categories reuse those row components and handlers, rather than duplicating
CAD state. Missing or duplicate adapters cause a visible fallback to the
original history instead of dropping rows.

**Build history / rollback** retains the original chronological list, dependency
controls, diagnostics and rollback/playback machinery. It stays mounted; the
category order never changes build order. Playback opens the chronological
view. Category grouping and collapse preferences are browser UI state, not new
geometry or a project-format change.

## Validation and reproduction

Final local checks: **26 resolver checks, 75 targeted unit tests and 260
application-browser assertions**, plus separate WebGL reflection comparisons.
TypeScript and the production build passed. See the
[validation record](../../docs/tmar-feature-categories-validation.md), including
failed intermediate attempts, exact source revision and platform limitations.

```sh
node --experimental-strip-types --test plugins/tmar-model-tree/scripts/check-categories.mjs
npx vitest run plugins/tmar-model-tree/tests tests/listSelection.test.ts
npm run build
node plugins/tmar-model-tree/scripts/e2e-categories.mjs
node plugins/tmar-model-tree/scripts/e2e-categories-production.mjs
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

The first browser script generates its own synthetic `.scanruler` fixture in
ignored `e2e-out/`; the production script consumes that file and starts `dist/`
with a fresh profile. Neither opens a personal browser tab. The first scenario
is registered in `ci.json`. Hosted CI was not used to claim these local results.

Save Project keeps category and note selections: it shares an import queue, but
is not a project replacement. Reopening a project (even the same filename) and
Undo/Redo still clear transient selections. The generic selection helper listens
to the committed history revision rather than the import queue's busy flag.

Native context menus remain in **Build history / rollback**. Grouped rows retain
their original edit, delete, suppress/restore and sketch-eye buttons. Category
Show/Hide never substitutes for suppression.
