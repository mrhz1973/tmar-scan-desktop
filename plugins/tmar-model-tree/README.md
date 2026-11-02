<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR feature-list multi-selection

Adds single-row, Ctrl/Cmd toggle, Shift range, Select all, focused Ctrl/Cmd+A
and Clear/Escape selection to the Reverse engineer **feature list**. Stable IDs
are used: AI-created rows do not join a previous selection automatically.
Built, suppressed and rolled-back rows can be selected. The inherited body-list
selection remains a separate, existing feature.

**Show / Hide** changes selected sketches and current CAD-body outputs, in one
undoable history operation. It never suppresses, rebuilds or deletes a feature
to hide it. Shared body outputs are deduplicated. A consumed, suppressed or
rolled-back feature with no independent displayed output is explicitly skipped;
use the final body list to control the resulting body. No batch feature deletion
or construction-element-list extension is implemented by this increment.

Features have a full-width, 40-pixel disclosure header with a large chevron
and item count, shared with the Notes panel. They collapse independently of
Notes. The browser remembers that
choice; rows remain mounted and selection is retained. New features do not
force a collapsed list open. Advanced filtered/grouped-list scope remains future work.

## Source

`FeatureSelection.tsx`: list provider, row adapter and toolbar.
`featureVisibility.ts`: current-output resolution and history integration.
`plugin.ts`: registration through `plugins/reverse/app/listExtensions.tsx`.
The generic ID/range helper is `src/plugins/listSelection.ts`.

Depends on `reverse`; optional at build time. With it omitted, the original
feature list remains. No duplicate CAD state, kernel or geometry is created.

[Validation](../../docs/tmar-usability-validation.md) uses synthetic Windows/Chrome
scenarios; native macOS keyboard handling and real large projects remain unqualified.

```bash
npx vitest run tests/listSelection.test.ts plugins/tmar-model-tree/tests
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
```
