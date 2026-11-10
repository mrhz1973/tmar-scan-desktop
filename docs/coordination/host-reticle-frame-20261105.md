# Host-owned Inquadra reticolo — integration contract (2026-11-05)

Scope: Host-only implementation on top of verified Patch Network 3D + Edit Surface 73a4f36 snapshot, commit ce6004c. Do not merge or modify the author's codex/edit-surface branch or any active CAD session.

## Ownership and behavior

- EditorViewportLease.publishReticleFrame?(frame) publishes part-frame millimetre min/max bounds and exact DraftStamp. It NEVER moves the camera.
- The host lease copies and validates the bounds and stamp. Malformed, inverted, or nonfinite bounds are discarded. The current partGroup.matrixWorld transforms all eight corners into a world-space box.
- Host-only OwnedEditorViewport.frameReticle(stamp) checks active source, exact stamp, source visibility, pointer capture and transform. It invokes SceneManager.fitBox with padded world-space bounds only when the host asks.
- workspaceEditors.frameReticle() requires editing phase, no ongoing Apply, exact current DraftStamp and no editor gesture. canFrameReticle controls button enablement.
- WorkspaceEditorDock owns the explicit Inquadra reticolo button. Publication, selection, preview, drag, Undo/Redo and initial load never auto-fit the view.
- SceneManager.fitBox -> OrthoViewport.fitCamera preserves view direction and up vector, adjusts pan and scale, and retains established clipping behavior. Orthographic projection is unchanged.
- Plugin must publish bounds containing all relevant reticle handles and invalidate them when no reticle is available. After selection/refinement/Undo/Redo/draft changes re-publish with the current stamp. Plugin must not mutate the borrowed camera.

## Compatibility

The publishing method is optional to preserve compatibility with existing author plugins. The button remains disabled until the plugin actually publishes the current bounds. This host-only branch does NOT implement plugin-side publication, nor qualify a plugin newer than 73a4f36.

## Verified in isolated host worktree

- npx tsc --noEmit: PASS.
- npm run build: PASS (with preexisting Vite large-chunk and module externalization warnings).
- 43/43 targeted tests in four host files, including the real lease boundary (no auto camera, transformed bounds, stale stamps, pointer capture, invalid inputs, disposal).
- Broader suite: 258/258 tests in 29 host and paired Edit Surface files, before adding two additional lease-boundary tests.
- No packaged desktop test, physically manipulated real part, actual plugin publication, or QuickSurface parity claim.

## Next integration block

Edit Surface author can wire publishReticleFrame from the viewport layer on their branch. On a separate isolated integration, verify the outside-the-viewport handle, the explicit click in source and compiled browser, no automatic camera movement, no CAD mutation and current stamp behavior. Keep the G1 and cylinder qualification gates independent.
