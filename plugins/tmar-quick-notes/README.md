<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR local notes, selection and navigation

Web-source extension; no desktop shell or agent connection is required.
Uses the existing Reverse engineer notes, IDs, editor, pins, project persistence
and imported-note provenance. It never turns on an agent or changes its credentials.

## Use

- **Note** on the view bar or in the list arms placement. Click the scan or CAD
  body in Reverse engineer; in Deviation use the visible scan-side single view.
- **Settings > Shortcuts > Add note** selects one unmodified A-Z letter or
  Disabled; default **N**, with Reset. Typing, dialogs, active CAD editors and
  conflicting operations keep their keys. Key combinations are not offered yet.
- Single-click selects a row. Ctrl/Cmd toggles separate rows; Shift selects a
  range. Select all or Ctrl/Cmd+A in the focused list selects its full contents.
- Double-click a row or press its target icon for **Go to note**. Selection
  keeps row positions stable: bulk-action controls stay in place and ordinary
  selection does not remove the previous focus feedback. The camera
  frames the saved anchor; **Return to previous view** restores the working view.
- The pencil edits/answers a note. The check changes its handled state. These
  controls never trigger camera navigation. Delete selected confirms exactly
  the selected notes; deletion is not undoable. Bulk handled/reopen preserves
  imported provenance and does not certify that a discrepancy was repaired.
- Notes can collapse without unmounting an unsaved editor. Escape cancels the
  editor or placement; collapsing does not save or discard its draft.

When labels or pins are hidden, Go to note temporarily highlights only its
marker/text. Leaving focus restores the hidden state without changing the
saved preference. Existing notes survive project save/load; UI selections,
focus and camera bookmarks are session-only.

## Current boundaries

Reference-only and split-view placement in Deviation remain unsupported, as do
placement during deformation animation, alignment picking and surface marking.
A valid saved marker can be located even if its body is hidden, clipped, missing
or changed. A visible warning distinguishes saved coordinates from a verified
current surface. No target is guessed, revealed or moved. The camera faces the
stored surface normal where present, and a large viewport reticle identifies
the exact saved point. Invalid coordinates and unsafe editing/operation states
remain guarded. A changed target still needs review; navigation does not repair it.
Reference-side notes and captured comparison metadata remain roadmap items.

Browser qualification uses generated geometry on Windows/Chrome, not private
scans or a live remote AI provider. macOS and desktop packaging remain unqualified.
See [validation](../../docs/tmar-usability-validation.md).

The full-width Notes header is the collapse/expand control. Current follow-up
checks are in [note-focus validation](../../docs/tmar-note-focus-validation.md).

## Source and integration

`EnhancedNoteList.tsx` owns selection/actions; `quickAccess.tsx` owns the shortcut
and settings; `noteFocus.ts` handles guarded camera focus; `notePlacement.ts`
handles the Deviation adapter. The original NoteCard and store are reused.

The plugin registers `settings.tools`, `view.tools`, `deviation.extra` and the
optional reverse `listExtensions` adapter. Camera bookmarks and temporary pin
focus are narrow reusable host hooks. No core import names this plugin.

This extension depends on `reverse` and is included at build time. Omit its
folder to retain the original note-list implementation; `?plugins=none` runs the
host without plugins. Hot installation is not implemented.

```bash
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
npm run build
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

The browser scenarios own isolated profiles and ephemeral servers unless
APP_URL is explicitly supplied. Never point them at an active user session.
