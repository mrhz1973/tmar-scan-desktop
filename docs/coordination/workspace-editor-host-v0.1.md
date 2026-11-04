<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Workspace editor host v0.1 — first runtime block

2026-11-03, Europe/Rome. Branch `feat/workspace-editor-host-20261103`, based on the design contract at `4a937825508c7a3ae8677821a00ba3b6e87e0873`. **Runtime implementation for isolated plugin integration, not a user release.** The author Edit Surface plugin has not been switched to this service or updated in this block. Versione 1 and existing previews remain unchanged.

## Available host API

`src/plugins/workspaceEditors.ts` now exports `registerWorkspaceEditor`, `workspaceEditors`, `useWorkspaceEditor` and host-adapter registration. Concrete TypeScript definitions live in `src/plugins/workspaceEditorTypes.ts`; do not import the documentation-only `.d.ts` companion from the earlier contract.

```ts
import { registerWorkspaceEditor, workspaceEditors } from '../../src/plugins/workspaceEditors'
import type { WorkspaceEditorController } from '../../src/plugins/workspaceEditorTypes'

// Register once in plugin.install(), after the plugin's controller exists.
registerWorkspaceEditor({
  id: 'tmar-edit-surface',
  apiVersion: 1,
  workspace: 'reverse',
  createSession: createEditSurfaceSession,
  Parameters: EditSurfaceParameters,
})

// The existing command tile can use this after coordinated plugin integration.
await workspaceEditors.open('tmar-edit-surface', { bodyId })
```

The example assumes real plugin exports; those functions are NOT supplied or faked by this host change. The checked-in QA controller is explicitly a test fixture, never imported by `main.tsx` or registered in the application build.

With Reverse installed, capabilities are `{apiVersion: 1, enabled: true, commitKinds: ['cad-copy']}`. Without a host provider, capabilities are null and opening is refused. No annotated-copy or parametric-surface-edit capability is advertised. The author's modal entry is unchanged until the author intentionally replaces it against this commit.

### Contextual outlets

`WorkspaceEditorDock` supplies `workspace.editor.parameters`, `.actions` and `.status`; the viewport lease supplies `.overlay`. There is one controller/session independent of React panel remounts. The first host block uses a **fixed right dock**, with scrollable parameters and an always-reachable action footer. It does not yet implement A/B/C placement or a resizable context dock. The existing model column is kept visible but inert while the session is active. Layout/Settings/timeline work remains separate.

`Parameters` receives `{controller}`. Subscribe with the controller's stable snapshot/subscribe API. The host owns Apply/Cancel; do not register another modal or a second set of project mutation buttons. Validation state, the exact current stamp, source validity, gesture state and draft-note count determine Apply availability.

## Main viewport lease

`controller.attach(view)` receives the EXISTING main canvas and camera, a session-owned group below `partGroup`, a DOM overlay root, part-space ray/projection helpers, scene-layer registration, capture/release and captured-pointer callbacks, frame callbacks, reference snapshots/subscriptions and an explicit source render mask.

No new WebGLRenderer, OrbitControls or render loop is created. Camera position/orientation is not reset on enter/exit; the dock causes normal viewport resize. The main camera is orthographic; math helpers are also unit-tested with a perspective camera and a transformed part. All CAD coordinates remain part-frame millimetres. The plugin must render in the supplied group and must not bake camera transforms into CAD.

Exclusive routing precedes host gizmo, marking and grips. A capture-phase handler takes an accepted editor pointer before navigation can track it; foreign pointers cannot finish the captured gesture. Plain empty-left does not orbit; the host navigation scheme remains responsible for its other gestures. Esc/cancel releases capture, and late pointerup is harmless in the tested mouse path. Touch, all navigation schemes/chords and all pen combinations remain unqualified.

The controller must maintain its own drag threshold, active-pointer identity, cancellation generations and mode semantics. The host does not reimplement the author's pole or D algorithms. `claimEditDrag()` is intentionally redundant in this first exclusive-session implementation: plain-left ownership lasts for the entire lease.

Call `view.maskSourceForPreview()` only while the plugin has a suitable preview. Its idempotent release composes with other masks and the existing feature-preview mask. It does not write `hiddenBodies` or persistent visibility. Source geometry remains borrowed; underlying edges/silhouettes and caps respect the mask. Other bodies and the scan remain in the host scene. Hiding the source hides the session group and interrupts an active gesture.

References expose immutable geometry, a geometry-to-part matrix, revision, visibility and `isCurrent()`. Initial CAD references are borrowed **body tessellations**, reported with `faceKey: null`; they are not exact B-rep face/edge/vertex targets. The edited source body is excluded; the plugin may use its own verified neighbouring-face preview separately. No borrowed geometry, material, BVH, canvas or renderer may be disposed by the plugin. Preview Zebra/clipping/CAD-edge rendering still requires the author layer to consume the supplied host context; this block does not claim that full author combination has run.

## Source binding and lifetime

Opening requires Reverse Engineer, a settled project body and no conflicting operation/editor. A document UUID is renewed on reset/project replacement and is not saved as a persistent CAD identity. Opening rechecks the document immediately after kernel readiness and settling, before reading the source; source, build, kernel, resource and frame guards are rechecked after asynchronous work.

Failed initialization, late completion, stale source, panel unmount, repeated cancellation and late fatal reports use session-bound cleanup. A disposed session cannot cancel a subsequent one. Disposal is once-only and cleanup failures do not prevent the other owned resources from being released. Host selection and deliberate navigation are preserved; a replaced document is not overwritten with old state.

Project save/recovery, conflicting imports and workspace switching are held while the first-generation editor is active. A dirty draft must be applied or cancelled. This does not persist the controller or its local history in a project file.

## CAD-copy Apply transaction

The new service does **not** call `reverse.import.step`. The legacy modal's queued generic-import risk is therefore NOT retroactively fixed: the author must use the new host Apply lifecycle before claiming that protection.

1. The host issues an operation ticket for the exact valid preview and freezes the controller.
2. `prepareApply(ticket, signal)` returns a standalone STEP byte copy, source binding and exact stamp; it must not mutate project stores. Nonzero draft notes, mismatched bindings/stamps or units are rejected.
3. An independent CAD kernel stages the entire current feature build plus one new import. It validates the result before any committed store/resource/history change. This first path requires exactly one resulting new body.
4. After all waits, source/session and the exact validated draft are checked again. Publication runs synchronously under `historyAtomic`, with no await between the final guard and the first mutation.
5. Kernel/maps, feature/resources and one project Undo action are adopted together; a tested publication exception restores the previous state/kernel/maps/history. On success the original remains and one copy is added. Duplicate simultaneous Apply calls share one promise. Receipt identity and STEP SHA-256 detect conflicting repeated publication; receipt retention is session-process memory, not durable restart/retry storage.

The staged candidate owns its kernel until adoption; abort/expiry disposes it and cannot publish. A held staging completion after Cancel is refused. Ordinary command busy guards plus UI/import/workspace gates hold unrelated writes, and source checks refuse superseded external state. Arbitrary third-party direct store writes or a throwing/reentrant observer that itself changes an unrelated store are not exhaustively certified.

`historyAsync` retains its previous behavior and is not used as rollback. The new synchronous `historyAtomic` records only successful publication. Reverse history snapshots include STEP resources so Undo removes a newly introduced resource and Redo restores it.

Existing notes are preserved. Draft notes block bare-copy Apply; there is no silent geometry-only fallback. Saving after Apply saves the resulting CAD copy, NOT pole-history, a recipe v2/v3 feature or durable face remapping. The model timeline must describe the actual import-copy operation.

## Verification and integration limits

See [the qualification record](workspace-editor-host-v0.1-validation.md). This block has real-kernel tests and a real source-browser workflow using an explicitly synthetic QA controller. The application also compiles for production. The author's full controller, snap/D/Zebra/notes combinations, production-browser embedding, arbitrary large projects, macOS and the desktop package remain separate acceptance gates.

Ownership is unchanged: author owns `plugins/tmar-edit-surface/**`; coordinator owns this host layer, contextual placement, transaction, Settings/layout/timeline and Patch Network. No author checkpoints after the existing integration baseline were cherry-picked here. Coordinate the author adapter against this branch before integration; do not enable an API stub on the older host.
