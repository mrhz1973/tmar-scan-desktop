# Edit Surface recipe integration contract

2026-11-03. Plugin-owned API for the coordinator's proposed `surfaceEdit` feature. Existing Apply-copy behavior remains available. No host feature registration is included here.

## Current integration boundary (2026-11-05)

The worker and `SurfaceDraft` also support version 5 for eligible planar G1
constraints and opt-in version 6 for compatible curved B-spline G1 constraints.
Version 6 uses the separate `createCurvedRecipe`, `restoreCurvedRecipe` and
`replayCurvedRecipe` worker actions; legacy recipe readers do not accept it.
See `G1-WORKSPACE-CHECKPOINT.md` for the qualified topology and test limits.

The main-viewport `WorkspaceSurfaceSession.prepareHistoryRecipe()` exposes a
preliminary, plugin-owned preparation API. It selects the v2–v5 or v6 path,
uses the session's stable body key, checks the source and epochs before return,
and rejects active gestures, notes, strips, provisional cylinders and unverified
drafts. It is not a freeze/restore transaction and does not publish a feature.
Preparing a legacy recipe may invalidate its CAD preview temporarily; the host
must wait for a new validated preview and check the current source and epochs at
its commit boundary. The method explicitly refuses drafts with notes until an
atomic host contract can preserve and revalidate them.
`isHistoryRecipeStampCurrent()` checks the original prepared object, unchanged
recipe contents, session and source/epoch freshness, active editor state and a
revalidated preview. This local guard does not replace replay/validation within
the host's atomic commit; the host must snapshot and recheck at its boundary.

For a draft with nonempty, currently resolved notes, the separate
`prepareAnnotatedHistory()` returns the CAD recipe and `{id,text,faceIndex,u,v}`
records as one bundle. `isAnnotatedHistoryStampCurrent()` requires the same
session, source, face, net and note contents and a current valid preview; it
permits an unchanged note to be re-resolved after the serializer refreshes the
preview. Its local guard also detects changes to the prepared recipe, but it is
not a transaction. The host must independently replay, validate, bind and
atomically commit the bundle.

`freezeHistory(prepared)` now provides a synchronous edit lock for either the
original prepared recipe or annotated bundle. It rejects stale or copied
preparations; while held, user edits and competing freezes are refused. Its
`isCurrent()` checks the source, original prepared object and content, net,
notes, and validated preview. `release()` is idempotent and must be called in
the host transaction's `finally` path. The host must snapshot inputs, perform
independent CAD/annotation validation, recheck `isCurrent()` immediately at
the atomic commit boundary, and handle invalidation or cancellation without
publishing. This is a plugin-side primitive, not a host history integration.

On 2026-11-06, `TEST_HISTORY_FREEZE=1` passed in the isolated source host on
the owner's `lego mod qs.stp` with a visible-face mouse note and Zebra. The
prepared annotated recipe was locked; competing note edits and altered recipe
contents were rejected, and release restored editing. The subsequent ordinary
annotated-copy Apply and save/reopen passed, with the original STEP SHA-256
unchanged. Evidence: `%TEMP%/scanruler-history-freeze-lego-qa/run-v5wAqD/result.json`.
This does not prove a host history transaction, editable feature persistence,
the exact coordinator host, or installed-app behavior.

The follow-up `TEST_HISTORY_REPLAY=1` replayed the locked annotated LEGO
draft in an independent worker using the host-exported source STEP. OCCT
reported a valid result with the same volume as the live draft
(1084.2683646894266 mm³); the lock remained current and the original file
hash was unchanged. The ordinary annotated-copy flow also saved and reopened.
Evidence: `%TEMP%/scanruler-history-replay-lego-qa/run-waxJ5O/result.json`.
Equal volume alone is not proof of geometric identity. This test does not
publish a parametric history feature or restore an editable feature from the
saved project; note persistence was exercised through ordinary copy Apply.

An additional `TEST_HISTORY_REPLAY=1` run compared the live and replayed
tessellations face by face on the same real LEGO STEP: all 81 face index lists
matched, and the maximum distance of 20,776 corresponding tessellation vertices
was 0 mm. The volume also matched and the original file hash was unchanged.
Evidence: `%TEMP%/scanruler-history-geometry-lego-qa/run-ZPRSHX/result.json`.
This compares one tessellation of one result, not exact B-rep equivalence or
every point of the continuous surfaces. Parametric project reopen remains a
separate host integration and qualification task.

`WorkspaceSurfaceSession.restoreHistoryRecipe(value)` restores a validated
recipe into a fresh, empty workspace session only. It rejects another body or
changed STEP bytes; a failed worker restore reports a fatal error to the host
and closes the session. A real OCCT
test restores an edited reversed STEP face and validates the resulting solid.
This API does not by itself restore notes or implement host project persistence.

After `restoreHistoryRecipe`, the host may await
`waitRestoredHistoryReady(signal?)` before rebinding notes. It resolves only
when that same restored net has a valid CAD preview; it rejects on draft or
source change, abort, session disposal, invalid preview, or a 60-second
timeout. It does not itself prevent edits, publish a feature, or replace the
host's source and transaction checks. Session tests cover a real OCCT restore,
an already-aborted signal, session disposal and a changed draft while waiting; installed-app and
host history reopening remain unqualified.

`restoreHistoryBundle({recipe, notes}, signal?)` composes fresh-session recipe
restore, preview validation and note rebinding. It snapshots its inputs. If
rebinding or waiting fails after adoption, it reports a fatal error and closes
that fresh session rather than leaving a partially restored draft. Session tests
using OCCT cover both successful restoration and an invalid UV that closes the
new session while leaving the original session valid. The first test attempt
timed out because its simulated timer did not advance after asynchronous work;
the corrected bounded timer-driving test passed. The host must still bind the
bundle to its persisted feature and preserve the saved CAD copy on failure.

`TEST_HISTORY_RESTORE=1` additionally passed in an isolated source UI on the
owner's LEGO STEP: a fresh independent session restored the serialized recipe,
the same control-point coordinates, and the note at the same measured position.
The ordinary annotated-copy Apply and saved-project reopen then passed; the
original STEP hash was unchanged. Evidence:
`%TEMP%/scanruler-history-restore-lego-qa/run-6tcV01/result.json`. The fresh
session was opened by the test, not by a host history feature, and the saved
project held a CAD copy rather than a re-editable parametric history feature.

After the restored draft has a fresh valid preview,
`WorkspaceSurfaceSession.restoreHistoryNotes()` can rebind a host-provided
array of `{id, text, faceIndex, u, v}` on that restored face. It resolves each
UV through OCCT, including trimmed-face classification, and installs all notes
only if every one resolves and the source/draft remains current. It does not
produce or persist the host's note records: an atomic host recipe-and-note
transaction and an authenticated association with the recipe are required.
An optional abort signal is linked to the session lifetime during rebinding;
an aborted worker request discards its late reply and adopts no partial notes.
The active OCCT computation itself cannot be interrupted until its worker ends.

`replaySurfaceHistory()` in `historyReplay.ts` provides independent worker
replay for a host transaction. It snapshots the recipe and STEP, verifies the
body key and STEP SHA-256, checks the host's source guard before and after async
boundaries, requires a valid CAD result and STEP, and disposes its worker. The
host must check the same source again at its own atomic commit boundary; this
helper does not publish a feature or preserve notes.

Worker and draft APIs alone therefore do not
make a saved project feature editable. An integration needs a versioned host
contract that binds the recipe to the upstream body and validated draft stamp,
commits it atomically with the CAD result and notes, and refuses stale sources.
Reopening must restore and revalidate note anchors against the restored face;
an existing saved CAD copy must remain intact if restore fails. The existing
copy-based Apply path remains available until this is implemented and qualified.

## Worker requests

All requests carry an `id`; replies carry `{id, result}` or `{id, error}`. The worker processes requests sequentially.

- `createRecipe`: after `open` and `select`, pass `net`, `continuity`, `lockedPoles`, the host's stable `bodyId`, and optionally `freeBoundary: true` only for the eligible free-boundary mode. Returns a JSON-safe `SurfaceEditRecipe` after CAD validation.
- `replayRecipe`: pass the original upstream `step`, saved `recipe`, and `bodyId`. Returns the validated preview including `step` for rebuilding the host feature. Does not alter the worker's interactive session.
- `restoreRecipe`: same inputs as replay. Returns `{faces, net, preview, continuity, freeBoundary, lockedPoles}` and adopts the validated source/face as the interactive base. Restore the returned net, boundary mode and locks in the UI. Failed restoration preserves the previous session.

The upstream input is the source before this surface edit, not the previously edited result. The exact imported BREP SHA-256, face/solid counts, face index, prepared NURBS SHA-256 and preparation type must match. This is deliberately strict: equivalent STEP exports can serialize differently and may require explicit reattachment. No automatic topological remapping is attempted. Engine/schema mismatches are rejected.

Pole edits use absolute positions relative to the prepared base net, not accumulated transforms. Locks protect the edited positions on reopening. Boundary protection is independently validated; G1 retains original boundary derivatives and does not create new tangency.

## Coordinates and runtime lifetime

Recipe version **2** explicitly records `units: "mm"` and `coordinateFrame: "imported-step"`. Coordinates are absolute positions in the CAD frame returned by OCCT STEP import, which normalizes supported source length units to millimetres. They are not display/world transforms or screen coordinates. The host must supply the same upstream STEP coordinate frame and apply display transforms separately.

Experimental version 1 recipes are rejected explicitly; there is no silent unit/frame assumption or automatic migration. Recreate the recipe from the verified upstream source when adopting version 2.

## Free-boundary recipes

Version 2 remains the unchanged protected-boundary format. Explicit free mode
uses version **3** with `boundaryMode: "free-natural"`; older readers refuse
the unknown version instead of silently treating it as protected. Version 3
requires one open face with the eligible natural four-sided contour and no
holes; replay rechecks actual CAD eligibility as well as all source and net
fingerprints. Unknown modes, a boundary-mode field on v2, or a `freeBoundary`
alias inside a serialized recipe are rejected. Existing v2 callers need no
new argument. Individual locks may include boundary poles and restore at the
edited positions. The saved G0/G1 choice is retained for returning to protected
mode; it does not claim boundary continuity while free mode is active.

Kernel and browser-worker tests cover v2 compatibility, v3 JSON replay,
manual boundary locks, a rational NURBS, invalid mode and source rejection,
and refusal of free mode on a solid or a face with a hole. The browser worker
passed on source and on the worker from an isolated production build. Reports:
`evidence/recipe/browser-free-boundary-v3.json` and
`evidence/recipe/browser-free-boundary-v3-compiled.json`. This contract is not
yet connected to a host feature, project history or project persistence.

`new SurfaceEditorKernel(kernel)` borrows the caller's runtime. `dispose()` releases only the editor's handles. `SurfaceEditorKernel.load()` owns its runtime and disposes it. Replay/restore use temporary editors sharing that runtime and release their own handles. No React, DOM or host store is required by the kernel API.

## Host ownership and acceptance still required

The coordinator owns feature registration, source dependency tracking, one host Undo/Redo transaction, project serialization, feature reopening and stale-source diagnostics. Preserve or explicitly flag notes/dependent references; do not silently reattach them to changed faces. Keep Apply-copy available during integration.

Remaining acceptance: import an annotated CAD body, create/reopen a `surfaceEdit` feature, host Undo/Redo, save/reopen the project, and verify notes, source body and dependencies. Worker tests do not establish those host behaviors.

## Verified checks

Kernel: `node node_modules/vitest/vitest.mjs run plugins/tmar-edit-surface/tests/recipe.test.ts` — two tests passed on imported planar and curved STEP, including replay STEP reimport and rejected restores.

Browser worker: `node plugins/tmar-edit-surface/tests/e2e-recipe.mjs` — passed against the existing isolated development server; report in `evidence/recipe/browser-result.json`. TypeScript no-emit passed. No new packaged desktop release is claimed.

Contract follow-up: kernel tests passed in 3.57 s total (2.45 s tests), including metre-to-millimetre STEP import and continued use of an injected kernel after editor disposal. TypeScript passed. Browser history and project recipe persistence remain host acceptance gates.

## Draft note anchors for the Edit Surface viewport

After a successful interactive evaluate, retain its previewRevision along with
the displayed geometry. While Zebra is active, the same face mesh is pickable.
Send notePick with the clicked point in imported STEP millimetres and that revision.
The caller must first verify that the hit belongs to the active face. The worker
returns an anchor (face, selectionRevision, u, v), CAD position at and the surface
normal. For the same selection, noteResolve with the latest validated revision
reevaluates this UV on a changed surface, including after Undo/Redo. Refused
evaluations invalidate picking. A different face selection invalidates draft
anchors, even when the new face has the same numeric index.

The revision and selectionRevision are session-local. Resolve draft anchors on
the final validated geometry before Apply. The host owns text, stable body/face
identity, the transaction and project persistence. Do not serialize a session
revision as a project face ID. An exported STEP by itself does not carry notes.

The EditSurface component accepts an optional applyWithNotes callback. On Apply
with notes it hands the host exactly one package: the final STEP, name,
faceIndex and all nonempty notes with text, UV, position and normal resolved on
that exact final evaluation. The host callback must atomically commit the new
body and notes or reject without committing either. With no callback installed,
annotated Apply is disabled and notes are explicitly marked as draft. Closing
asks before discarding notes. STEP export carries geometry only.

Browser QA: e2e-perforated.mjs --reopen --note. A real click and text entry
with Zebra enabled followed the edited face from Z 10.163 to 10.874 mm. The
text was retained and Apply was disabled in the absence of an adapter. After
explicitly removing that draft, STEP export/reimport yielded a valid solid.
This does not verify host persistence. See evidence/perforated/run-pIwcn6/.

After final export evaluation, finalFaceWitness(previewRevision) serializes
the validated selected face as OCCT BREP and returns its face index, selection
revision and preview revision. Stale revisions are rejected. applyWithNotes
now passes this witness with the editor session UUID and each draft note's ID
and UV anchor. The host gateway still owns document context, operation
idempotency, artifact hashing and binding to the newly imported face.


## Shared main viewport: integration prerequisites

The owner requires editing in the existing viewport, with the scan, other bodies and camera retained. `populateSurfaceCage` and `pickNetAt` are reusable plugin primitives, not an integrated host tool. They do not by themselves arbitrate input, preserve host visibility or implement scene occlusion.

The host currently dispatches existing gizmo/marking/grip handlers before plugin layers; `claimDrag` only takes navigation drag. A surface-edit session therefore needs an exclusive, scoped interaction lease that refuses or suspends conflicting gestures and always restores input, capture, cursor and hover on completion, cancellation or failure.

The host body-preview slot is shared and its setter resets materials across bodies. Surface editing needs an exclusive preview lease, preserving and restoring the actual prior visibility of each affected body and tracking changes while the preview is active. Do not silently replace another tool's preview. The host should reject stale asynchronous updates after project body, build or alignment changes. No host code or live session is changed by this plugin checkpoint.


### Partial resource ownership checkpoint

`SurfaceRuntime` owns `SurfaceWorkerClient`, `PreviewQueue` and `SurfaceHistory` and is created on explicit editor entry. `SurfaceDraft` now exclusively controls that history and preview queue for the selected face, and the prototype session owns the draft plus notes and Zebra options. The dialog still owns temporary strip and some display state. This is a preparation step, not `createEditSurfaceSession`, a complete persistent workspace controller, `freeze`, `prepareApply`, a main-scene layer or a host capability.

A source-only synthetic-project test holds an actual export-evaluation response until the editor has unmounted, then delivers it to the old callback. No host body, feature or STEP file appears. This does not cover an import already placed on the command queue: source/session must be checked by the host immediately before mutation, under its transaction gate. See `tests/e2e-close-during-apply.mjs` and `evidence/main-view-preparation/session-close-source.json`.

`WorkspacePreview` is an unconnected helper for face meshes in a host-supplied part-frame group. It owns and disposes its own geometries and materials, uses an injected temporary source mask, and never creates a renderer or camera. The host must supply an atomic mask/restore and clipping and input leases; the helper itself cannot guarantee scene occlusion, visibility changes, persistence, or exclusive pointer handling. `SurfaceGesture` is used in the current dialog but does not capture pointers or publish project changes on its own.
