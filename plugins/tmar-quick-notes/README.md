<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR notes in Deviation

> **Implemented and merged into `main` via [PR #1](https://github.com/mrhz1973/tmar-scan-desktop/pull/1), source revision `496fe2eb0fb7a140fa9b8d9707e126030db2b70c`.** Scan-side Deviation notes are implemented; the wider quick-notes roadmap is partial.
> Documentation checked November 2, 2026. This is a web-source feature, not a desktop release. [Recorded validation](../../docs/tmar-web-validation.md) covers Windows/Chrome; macOS and live-provider qualification are pending.

First build-time web implementation of the planned quick-notes extension.
No desktop shell is required. The rest of the quick-notes roadmap is not
implicitly implemented by this first increment.

## Use

In **Deviation**, the existing **Notes for the agent** panel is now available.
Activate **Note**, click a point on the visible **scan-side** comparison map,
write the observation and keep it. The map and workspace remain active. The
same record, ID, text and position appear in Reverse engineer and are stored
in the existing `.scanruler` project's `reverseNotes` section. Escape cancels
placement. Normal deviation reading/pinning resumes when placement ends.

This first implementation follows upstream's note visibility under
**Settings → Agents**. It never enables that setting or connects an agent on
the user's behalf. The existing privacy warning and provider behavior apply.
An independent local-only annotation mode remains future work.

## Explicit scope and limitations

- Placement is on the scan in the single main Deviation viewport, using the actual
  hit coordinates in the part's frame. A display alignment is not applied twice.
- Reference-side placement is refused with an explanation, rather than
  incorrectly creating a scan note. Generic reference/CAD-side annotation
  anchoring and comparison-value metadata remain planned.
- Exit split view and stop deformation animation, alignment picking or surface marking before
  placing a note. Busy operations, hidden scans, empty space and clipped-out
  hits are guarded. Ordinary measurement pins are not replaced.
- Custom keyboard binding, Go to note, per-workspace label preferences and
  collapsible panels are separate roadmap items, not delivered here.
- The inherited note editor, agent command API and project format are reused;
  this is not another annotation database or a new AI service.

## Source and integration

- `plugin.ts`: registers the Deviation panel and placement adapter.
- `DeviationNotesPanel.tsx`: existing note list, placement guards and Escape.
- `notePlacement.ts`: explicit mode checks and scan-surface picking.
- `tests/deviationNotes.test.ts`: guards, coordinates and adapter lifecycle.
- `scripts/e2e-tmar-web.mjs`: synthetic browser regression shared with the
  `tmar-body-export` plugin.

The dependency on upstream `reverse` is intentional and documented. The host
has a generic `deviation.extra` panel slot. Reverse engineer exposes
`registerNoteWorkspace` in `app/noteWorkspaces.ts` and an optional
`NoteList.placementBlocked` prop. No core file imports this plugin by name.
The original reverse-note behavior stays available without this extension.

Plugins are bundled at build time. Exclude this folder to omit the extension;
`?plugins=none` disables all plugins for a host smoke check. Removing the
reverse source also requires omitting dependent TMAR plugins. Hot plugin
installation is not available.

## Tests

```bash
npx vitest run plugins/tmar-quick-notes/tests/deviationNotes.test.ts plugins/reverse/tests/reNotes.test.ts tests/panelExtensions.test.ts
node plugins/tmar-quick-notes/scripts/e2e-tmar-web.mjs
npm run build
node scripts/check-plugin-boundary.mjs
```

The browser regression starts its own ephemeral local Vite server unless
`APP_URL` is supplied, uses a fresh headless Chrome profile and synthetic boxes,
and closes its server/browser afterward. It stubs the agent socket: it never
contacts an existing MCP session. It checks note placement, preservation of
the map, shared notes, Escape, save/reopen, and body STL downloads. It is not
a live end-to-end test with a remote AI provider. Set `CHROME` if required.

## Roadmap and contribution scope

See the [main roadmap](../../README.md#status-and-roadmap) for outstanding features. Change this plugin in an isolated branch and include its tests and README updates in the pull request. Do not present unrelated planned features as delivered or modify private scans for public fixtures. The validation record describes the implementation run; this documentation synchronization did not rerun those tests.
