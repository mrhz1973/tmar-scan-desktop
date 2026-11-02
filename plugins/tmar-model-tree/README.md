<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR categorized feature selection

**Branch status: implementation draft; application build and browser validation
are still required. Not a published preview or desktop release.** The baseline
is `742d91d98b693735be2bafb36ff37b66bfa294c6`, including the integrated Zebra
reflection improvement from PR #6. No Zebra source is changed by this work.

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

## Validation and next gate

The dependency-free classification/target tests were executed: **26 passed**.
The pure helper passed strict TypeScript checking. Changed TypeScript/TSX files
were syntax-transpiled only; this is not a full application type check/build.
The new adapter Vitest tests and all browser regressions are **NOT RUN**.
See [the integration handoff](../../docs/tmar-feature-categories-handoff.md).

```sh
node --experimental-strip-types --test plugins/tmar-model-tree/scripts/check-categories.mjs
npx vitest run plugins/tmar-model-tree/tests tests/listSelection.test.ts
npm run build
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

Before integration, update the old mixed-list selection assertions in the
usability browser test to category-scoped selectors, retaining its geometry,
Undo, export and note assertions. Then run the full targeted browser regressions
including Zebra and production note focus. Do not reload a live user session.
