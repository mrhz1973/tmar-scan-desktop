<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Workspace editor embedding contract — v0.1

2026-11-03, Europe/Rome. **Design handoff; NOT a registered/runnable API.** Names below are reserved for implementation. The plugin can separate its controller, controls and scene layer against this contract, but must not enable embedding until the host advertises the real capability. This document does not integrate author checkpoints, implement transactional notes or `surfaceEdit`, or publish a numbered preview.

Inspected host baseline: `39e92174927ebe43fcab409f03fb78ab470e89da`. Delivered Versione 1: `e9058d6`. Author sequence: `44f678d → 5899391 → 63cbe44 → f993820cf57ccaeab63172e1d1843d1021575fc1`. Author test results remain author evidence, not coordinator reruns.

## 1. Existing facilities versus new adapter

Existing: `PluginHost.sceneRef`; `SceneManager.addLayer()` and `layerHost()`; `SceneLayer` in `src/viewer/sceneLayers.ts`; `registerPanelExtension`; `registerHistory` / `LocalHistory`; command busy guards; `captureView()` / `restoreView()`; `reverse.body.edit_source` documented in `plugins/reverse/EDITOR-SOURCE.md`.

The main view exposes an **OrthographicCamera**, whereas the modal editor creates its own PerspectiveCamera, WebGLRenderer and OrbitControls. Do not transplant those into the main workspace. `PluginRuntime.stage/hideViewport` is NOT the route: covering the main canvas with another is not embedding.

New and host-owned: versioned editor registry/session service, contextual outlets, exclusive input lease, source/revision binding, transient render overrides and transactional Apply adapter. The existing prop-less PanelExtension registry alone cannot provide this lifecycle.

## 2. Entry, slots and layout

Proposed module: `src/plugins/workspaceEditors.ts` (not present yet). Proposed registration: `registerWorkspaceEditor(definition)`. Activation: `workspaceEditors.open('tmar-edit-surface', {bodyId})`.

| Logical outlet | Content | Placement |
| --- | --- | --- |
| `workspace.editor.parameters` | Plugin controls bound to one session controller | A/C: right dock; B: left Tools tab |
| `workspace.editor.actions` | Host-owned Apply / Cancel and exit state | Fixed dock footer, always reachable |
| `workspace.editor.status` | Host validation/busy/stale/error state plus plugin detail | Beside actions, not under a long scroller |
| `workspace.editor.overlay` | Small DOM handles/labels (D, snap feedback) | Root belonging to the SAME main viewport |

These are typed session-aware outlets supplied by the new service, not names to register blindly with today's PanelExtension. Keep `reverse.create.after-network` for the recognizable command/icon; its future click activates the service. No new window/tab/modalback, full-screen overlay canvas or second animation loop.

A/B/C compose the same controller/components. The host owns docking; the plugin does not inspect layout names. Block layout switching and a second CAD editor for the entire first-generation session with an explanation. Panel resizing must not recreate the controller/worker. Simple/Advanced is a separate preference.

## 3. Controller separation

The plugin exports `createEditSurfaceSession(ctx)` and a presentation-only `Parameters({controller})`. Create the controller once per session, outside panel mounting. StrictMode/remount must not duplicate it. The old dialog may remain a standalone QA wrapper until embedding is qualified, never a silent fallback in an advertised embedded build.

```ts
interface WorkspaceEditorDefinition<C extends WorkspaceEditorController> {
  id: string;
  apiVersion: 1;
  workspace: 'reverse';
  createSession(ctx: WorkspaceEditorContext): Promise<C>;
  Parameters: React.ComponentType<{controller: C}>;
}
interface WorkspaceEditorController {
  getSnapshot(): EditorSnapshot;
  subscribe(listener: () => void): () => void;
  attach(view: EditorViewportLease): () => void;
  cancelGesture(): boolean;
  undo(): void;
  redo(): void;
  freeze(ticket: ApplyTicket): () => void;
  prepareApply(ticket: ApplyTicket, signal: AbortSignal): Promise<PreparedCadCopy>;
  dispose(reason: 'applied' | 'cancelled' | 'source-invalid' | 'open-failed' | 'host-error'): Promise<void>;
}
```

**Transport and lifecycle types:** [type-only companion](edit-surface-workspace-contract-v0.1.types.d.ts). Its generic Camera/Group/Geometry/Layer bind to the existing host types; Parameters binds to React.ComponentType. These declarations are documentation, not an importable runtime implementation.

Creation receives a host-issued AbortSignal and an idempotent LIFO cleanup stack (`ctx.own`). Register acquired resources immediately, including before await. If createSession rejects or the source changes during open, host runs that stack even though it never received a controller. Normal close first revokes input/cancels pending work, detaches scene/UI, then awaits controller disposal and the remaining stack. Late completion must not reattach. Cleanup errors are reported but cannot prevent releasing the other owned leases.

`freeze(ticket)` rejects a mismatched stamp, locks all draft mutations (geometry, face, locks, notes and modes) and returns an idempotent unfreeze callback. Preparation/commit failure invokes it; successful close disposes the session. Host rechecks the controller stamp after prepare in addition to checking the source.

Snapshot: immutable/stable until change; contains sessionId, selectionEpoch, draftEpoch, local-history revision, dirty flag, gesture state, validation state, current validated stamp, canUndo/canRedo and draft-note count. Notify subscriptions for locks/history/modes, not only geometry. Host derives canApply from the exact current validated stamp AND host capability/source checks, not from a plugin boolean.

## 4. Main scene, coordinates and borrowed resources

The viewport lease lends the camera/canvas, ray/project helpers, a session-owned group below partGroup, a DOM overlay root, layer registration, input capture and invalidation. Reuse SceneLayer hooks for press/pick/hover. The new lease additionally supplies scoped captured-pointer move/up/cancel/lost-capture subscriptions and interruption callbacks; the current SceneLayer API does not itself expose all of them. The host schedules rendering; the plugin does not create another renderer or OrbitControls.

All editor geometry is **part-frame millimetres**, as returned by current-source STEP; the worker calls this `imported-step`. The renderer applies partGroup.matrixWorld ONCE. Convert world pick rays into part coordinates before drag/snap and normals using the appropriate normal matrix. Never bake camera transforms into CAD. Support the host camera's actual projection instead of copying the perspective-only drag formula. Read live camera/viewport bounds, capturing direction/frame at gesture start.

No auto-fit/home/projection change on enter or exit. User orbit/pan/zoom stays as the current view on exit; restoring the initial pose must not erase deliberate navigation.

Plugin owns preview meshes/net/decorations/scratch BVHs/worker handles only. Host scan/CAD buffers, materials, BVHs, renderer and controls are borrowed: no mutation/disposal. References have immutable geometry, partFromGeometry, identity/revision and visibility predicate. Geometry/alignment/source replacement invalidates the session. Visibility-only changes update reference candidates without changing the source CAD.

Avoid coincident original/preview rendering through a **host transient display mask**, never persistent body visibility. Current preview contains the whole edited body, so the first adapter masks its source render representation and draws the full preview. Other project bodies/scan remain in the existing scene. Exclude the source-body duplicate from snap; other faces of the verified editor preview may be targets. User visibility choices are layered separately and survive cleanup. Hiding the edited body also hides its preview and suspends picking, without losing the draft.

Zebra/clipping/CAD edges follow the shared view and session layer. Invalid/stale preview is never a note-pick/snap target. Tessellated snap is not exact B-rep edge/vertex snap.

## 5. Source binding and asynchronous identity

Host reads `reverse.body.edit_source({body})`, binds it to documentEpoch, kernel/build generation, bodyId/bodyKey, frame revision and STEP digest, then checks it again after asynchronous initialization. Scope of initial embedding: verified project body only. A standalone STEP cannot assume the live scan's frame; its explicit import is separate.

SourceBinding is immutable, session-local and host-issued. Body keys/build numbers are optimistic guards, not durable face IDs or mutation permits. Opening another project with the same numeric IDs/counters must invalidate it via documentEpoch.

Every request/reply is bound to `{sessionId, sourceEpoch, selectionEpoch, draftEpoch, requestId}`. SelectionEpoch increments on every face selection, including selecting the same index again. DraftEpoch increments for geometry, constraints/modes, Undo/Redo and gesture-cancellation invalidation. Accept results only for the current tuple. An older valid reply cannot override a newer rejection. An old valid shape may remain visible, marked stale/invalid, with Apply/export/note placement disabled.

A cancelled input sequence is generation-tagged: processing its final pointerup, lost-capture callback, or queued worker result twice must be harmless.

AbortSignal is a cancellation request, not proof that OCCT/WASM stopped. Discard late results after cancel/close/mode/face change. Failed STEP opening also clears history belonging to the replaced worker document.

## 6. Input and Undo routing

Only the active editor leases interaction. Left picks/drags the net or explicit offset D; empty left does not orbit. Use the host's configured navigation scheme, with existing Shift-navigation when left would conflict; never install competing OrbitControls. The host supplies part-space ray/project and capture/release helpers. Preserve the author's CSS-pixel threshold; subthreshold clicks cause no geometry change/history entry. Alt suspends snap unless the configured navigation gesture consumes it; never execute both actions.

Escape during either a pole OR D/strip gesture restores the pre-gesture state, invalidates pending replies, immediately releases that pointer capture, restores navigation and keeps the editor open. Pointercancel/lost capture/blur/disposal also clean up. Repeated cleanup is harmless. The later pointerup must not Apply, create a strip or reselect a face. Without an active gesture, Escape requests Cancel with dirty-note confirmation. Settings and text/numeric fields have shortcut priority; Enter in a field commits the field, not CAD.

Register one history bridge before toolbar watch hooks mount. During an active editor, toolbar and keyboard Undo/Redo use controller history, including locks/modes/redo-branch pruning. **historyBlocked() currently runs BEFORE activeLocalHistory():** blocking unconditionally for the whole session would disable local toolbar Undo. Block opening/commit/active gesture, expose reactive local canUndo/canRedo, and guard unrelated geometry commands/import/rollback separately. Controller Undo during pending evaluation must invalidate the superseded result.

Global tree/model selection is distinct from pole selection. Preserve the incoming host selection without extra project-history steps. Cancel/Apply restores it only if its document/binding is still current; never restore old selections into a replaced project. Report the new copy without silently selecting or deleting the original.

## 7. Apply and Cancel

Lifecycle: `opening → editing → preparing → committing → closed`. Preparation/commit failure returns to editing with an explicit error and intact draft; external source change enters source-invalid. One active session and in-flight Apply per document.

1. Host refuses active gesture, pending/invalid geometry, stale binding and unsupported capability; issues operationId/ApplyTicket for the exact validated stamp and freezes edits.
2. Plugin prepareApply validates and exports that exact state. Return STEP bytes, mm/part frame, name, source binding and matching stamp. Do not mutate stores/history in prepare.
3. Host hashes payload, stages CAD import/validation outside committed stores, then compares document/source again under its exclusive mutation gate immediately before publication.
4. Publish new copy, resources and ONE project-history action together. Same operationId+hash retry returns the same receipt; same ID with different payload is rejected. Double click/timeout retry must not duplicate a body.
5. Exit only after commit receipt. Failure leaves no orphan body/resource/note/history step and keeps the draft usable. Cancel cannot interrupt the atomic publication into a half-committed state; if publication already succeeded, return its receipt instead of reporting that nothing happened.

**historyAsync is not a transaction:** its finally block currently records even on error. Stage and publish safely; wrapping a partially mutating import is insufficient. Never switch off global busy checks; use a private session-scoped permit for the host adapter's own mutation.

First capability: cad-copy, original retained. Annotated-copy and parametric-surface-edit are separate advertised capabilities, absent until implemented/qualified. Draft notes without annotated capability disable Apply; no silent bare-STEP fallback. Later annotated support must preserve finalFaceWitness/session/IDs/UV/text and bind verified new faces atomically. A session face index is not persistent identity.

Saving after cad-copy Apply saves the resulting copy, NOT the editor history or a v2/v3 parametric recipe. Timeline represents that actual copy operation. In initial embedding, Save during an active draft is blocked with an explicit Apply/Cancel message. New/Open/workspace changes ask before abandoning dirty work. A forced external replacement invalidates the editor without restoring the old document.

Cancel before commit aborts pending work, advances invalidation epochs, removes owned layers/DOM/leases, releases capture, removes only session masks, disposes owned resources and preserves project state without a history step. Never overwrite intentional user camera/visibility changes.

## 8. Ownership and acceptance

Coordinator: registry/outlets, host scene/input/reference leases, command/history bridge, source/Apply transaction, A/B/C, Settings/tooltips and Patch Network. Plugin author: controller/Parameters/SceneLayer decomposition, worker/recipe/validation, local gestures/snap/D, lifetime tests. No unilateral host changes; no coordinator rewrite of the plugin viewport in parallel.

Author can now isolate controller state from SurfaceDialog and prepare renderer-independent interactions against a borrowed camera/group. Runtime entry remains gated until the coordinator publishes the real capability. Contract approval is not runtime acceptance.

Mandatory isolated acceptance: one existing canvas/renderer; no entry/exit auto-fit; source buffers/global selection preserved; A/B/C dock/resize lifecycle; stale source and same-ID new document; disposal twice; orthographic world/local/screen motion and transformed partGroup; reference visibility/selected-face exclusion; original free-boundary regression unchanged; compiled D/cancel/chain; true Esc-before-mouseup/capture-release and subthreshold gesture; late success/failure and local history without project undo leakage; Apply retry/double click/failure injection; one project Undo/Redo and valid reopened copy; unsupported notes/recipes explicitly blocked; Zebra/clipping/labels and listener cleanup. No QS parity inferred.

No user session, author worktree or numbered preview is modified by the contract. Versione 2 is assigned only for a distinct tested delivery. Static review/type validation does not qualify the CAD runtime.

## 9. Handoff qualification

This is coordinator static design review, not independent-agent approval. Two bounded delegated Codex CLI reviewers (architecture and QA/lifecycle) were attempted with ephemeral, read-only execution and prompts prohibiting tools/CAD access. Both failed at startup: the CLI default model was rejected for this account and its catalog parser also rejected an effort value. No reviewer report or runtime test resulted. No global CLI/config/cache repair was attempted. Small scratch outputs are on D:, not a new CAD build on C:. See [handoff review](edit-surface-workspace-contract-v0.1-review.md).
