<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR workspace display controls

The lower 3D view bar has a **Labels** button in each supported workspace,
including Reverse engineer, Surface Deviation and Mesh Tools. It hides text,
not geometry or saved annotations. A **Notes** button additionally hides note
markers and text; Reverse uses its existing Notes key, other 3D workspaces get
one while notes exist. Hidden pins do not take clicks.

Labels and note-pin preferences are remembered per workspace and browser under
`tmar.display.workspaces.v1`, with safe defaults if storage is unavailable.
New/editing notes can reveal their pins, as the existing host behavior does.
The quick-notes plugin can temporarily focus one hidden note without changing
these preferences. Advanced per-category Settings controls remain planned;
this increment provides the requested bottom-bar controls, not a new 2D overlay policy.

## Resizable left panel

Drag the 12-pixel-wide vertical divider beside the left column. Arrow keys move
it by 16 px (Shift: 64 px), Home/End use its current bounds, Enter or double-click
resets to 336 px. Escape cancels a drag. Settings > Panel layout offers the same
width preference. The 260–720 px range is constrained to retain viewport space.
Phone-width layouts remain stacked and do not expose this divider.

`PanelResizeHandle.tsx` owns pointer capture and the accessible separator;
`panelWidth.ts` owns validated width preferences under `tmar.layout.panelWidth.v1`.
The optional `workspace.divider` slot adds no wrapper around the viewport and
does not remount the model while resizing. Omitting this plugin restores the
host layout. See [follow-up checks](../../docs/tmar-note-focus-validation.md).

`DisplayControls.tsx` owns UI/preferences; `plugin.ts` registers `view.tools`,
`workspace.divider` and `settings.tools`.
It reuses `showLabels`, `pinsShown` and the viewport's CSS label policy.
The shared scene synchronization now respects the label switch in all 3D
workspaces rather than forcing labels on outside 3D Measure.

Build-time dependency: `reverse` for pins. No external plugin installation.
[Validation](../../docs/tmar-usability-validation.md).

```bash
npx vitest run plugins/tmar-display-controls/tests
node plugins/tmar-quick-notes/scripts/e2e-usability.mjs
```
