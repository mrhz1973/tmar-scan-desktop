<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Annotated CAD-copy v1 — actual host contract

3 November 2026, Europe/Rome. Branch `feat/annotated-cad-copy-v1-host-20261103`,
based on `27c75c3364511dd77e2ec0c5b8f314f529df6291` (PR #21). This is a separate
host increment. The frozen host `a28c747`, PR #20, PR #21, main, author worktrees
and Versione 1 are not changed by this branch. No merge/release is implied.

**This supersedes the design-only PR #19 for the implemented transport.** Import
actual types from `src/plugins/annotatedCopyTypes.ts` and
`src/plugins/workspaceEditorTypes.ts`, not the earlier documentation declarations.
The author plugin `8a02e89aac7a99c13fbe4fd0153d50d1d80e4959` has been paired in QA
but does NOT yet implement the two optional annotated methods. Its notes must
remain drafts and Apply stays blocked until the author adapts the controller.

## Negotiation and backward compatibility

The Reverse host now advertises, on THIS branch only:

```ts
{
  apiVersion: 1,
  enabled: true,
  commitKinds: ['cad-copy', 'annotated-cad-copy'],
  annotationVersion: 1,
}
```

The old `freeze(ApplyTicket)` and `prepareApply(ApplyTicket, signal)` remain
unchanged and exclusively handle an unannotated copy. No public viewport-lease
change is required. The host additionally checks both optional controller methods
exist, the annotation version is 1, and the adapter supplies annotated staging.
A capability name alone does not enable annotated Apply.

Add to the controller (types are the actual exported runtime interfaces):

```ts
freezeAnnotated(ticket: AnnotatedTicketV1): () => void;
prepareAnnotatedApply(
  ticket: AnnotatedTicketV1,
  signal: AbortSignal,
): Promise<PreparedAnnotatedCopyV1>;
```

`EditorSnapshot` adds optional `notesRevision: number`. With notes it must be a
nonnegative safe integer. Increment it for text, reply/status, add/remove and
anchor changes; do not recycle it after Undo. The current `draftNoteCount` must
count ALL notes the package must preserve. An armed picker, unresolved or pending
anchor, blank note, inconsistent selection, or calculation in flight must keep
Apply unavailable. A successful package contains every draft note; no silent
filtering or geometry-only fallback is allowed.

## Freeze and prepare

The host generates `AnnotatedTicketV1` with `annotationVersion: 1`,
`mode: 'annotated-cad-copy'`, operation UUID, the exact source binding, validated
preview stamp and notesRevision. `freezeAnnotated` must synchronously prevent
ALL draft mutations, including note text, locks, face changes and local Undo.
Its returned callback unfreezes the same draft when preparation/publication is
refused. On success the controller is disposed instead.

`prepareAnnotatedApply` must not import geometry, write noteStore, change history,
or alter the source. Resolve all UV anchors on the EXACT final validated CAD,
obtain `finalFaceWitness` for that evaluation, and return an owned STEP byte copy
with the following fields:

| Field | Required meaning |
| --- | --- |
| annotationVersion / kind | `1` / `annotated-cad-copy` |
| operationId, source, stamp | Exactly the host ticket, unchanged |
| notesRevision | Exactly the frozen note revision |
| units / coordinateFrame | `mm` / `part`; not camera/world coordinates |
| name / step | Nonempty filename and UTF-8 STEP bytes without BOM |
| witnesses | Exactly one verified face witness in this first transport |
| notes | Nonempty array of ALL draft notes, 1–200 |

The witness is `{key, kind:'occt-face-brep', brep, brepSha256,
finalStepSha256, stamp, diagnosticFaceIndex}`. Hash the exact UTF-8 BREP string
and the exact STEP bytes with SHA-256. The diagnostic face index is NEVER used
as persistent identity. Each note is `{draftId,text,done?,reply?,target}` with:

```ts
{
  kind: 'copy-face',
  witnessKey: witness.key,
  sourceUV: [u, v],       // Parameters on the final BREP witness, not the old face.
  resolvedAt: [x, y, z], // Part-frame millimetres on that final evaluation.
  orientedNormal: [nx, ny, nz], // Finite unit normal with face orientation applied.
  resolvedStamp: ticket.stamp,
}
```

Input size limits: STEP 128,000,000 bytes; witness 16,000,000 characters; filename
240 characters; text/reply 100,000 characters each. Unsupported scan/edge/vertex,
multiple-witness or mixed-face bundles are refused rather than partially stored.
The host owns hashes of the whole envelope, note UUIDs/display IDs, destination
feature UUID and committed binding. Existing notes elsewhere remain unchanged.

## Staging and atomic publication

The host owns an immutable structured clone before asynchronous hashing. It
validates field/count/stamp/hash coherence, prepares the whole CAD build in an
independent kernel, and requires exactly one new body. It verifies the witness
against candidate destination faces, rejects missing or ambiguous correspondence,
and recomputes destination UV on the actual imported trimmed face.

The correspondence is conservative geometric verification, not a mathematical
identity proof: bidirectional sampled positions/oriented normals, area, centroid,
surface type and edge count. Position tolerance is 1e-5 mm, normal dot threshold
1−1e-6. Trim/inside tests reject holes/outside anchors. No nearest-face fallback.
Current qualification is on synthetic box faces; arbitrary NURBS, periodic faces,
ambiguous coincident faces and very complex trims need their own acceptance.

After ALL waits, source/document/session, preview and note revision/count are
checked again before synchronous publication. PR #20's reference-notification
suspension remains in place. Geometry/resources, optional source hiding, notes and
one Undo action are committed together. Reverse/notes/history subscribers receive
only the completed state; writes reentering these stores during notification flush
are refused and diagnostic errors are retained, not used to pretend a committed
transaction failed. The gate is not a general guarantee for arbitrary third-party
unmanaged store writes.

The original is retained. The PR #21 checkbox is captured with this operation;
turning it off preserves the earlier keep-both-visible policy. A failure restores
CAD maps/kernel/stores and note state; notes changed independently AFTER staging
are not rolled back to an old staging snapshot. Cancel before publication prevents
late insertion. Double Apply shares one operation. Runtime idempotency receipts
are in memory; no durable retry service is claimed across application restarts.

## Receipt and persistent records

The ordinary receipt fields remain, including plural `createdBodyIds` and
`historyActionId`. Annotated success adds `mode:'annotated-cad-copy'`,
`annotationVersion:1`, `envelopeSha256`, `createdFeatureUuid`, and
`notes:[{draftId,noteUuid,displayId}]`. The envelope hash covers note text/anchors
AND geometry; the same STEP with different text is not an identical envelope.

Native projects store each attachment under the existing `reverseNotes` section.
The import feature retains its versioned UUID, artifact hash and final-face BREP
witness/hash. An attachment stores BOTH `witnessUV` and destination `uv` because
STEP import need not preserve the witness parameterization. It also retains the
note UUID, operation/draft IDs, feature UUID, hashes and verified/unresolved status.
The STEP resource is still a native archive member, not duplicated into each note.

On load, a saved `verified` status is not trusted. Notes are initially unresolved;
the host rechecks persisted artifact hashes and the rebuilt CAD witness, then
refreshes destination parameters/fingerprint from that verified correspondence.
An absent/changed resource, replaced body or mismatched anchor keeps the text and
marks the target unresolved. No nearest-face remapping is performed. Opening a
project in an older build has NOT been qualified for preserving these new fields.

## Undo/Redo

History carries an operation-owned note delta rather than a snapshot of all notes.
Undo removes the copy and its owned notes; unrelated edits survive. Redo restores
the latest owned text/status and does not resurrect explicitly deleted notes.
Display IDs remain monotonic within the document. Unsafe unowned notes depending
on the copy cause Undo refusal before geometry mutation. Source visibility uses
PR #21's separate restore effect; both effects compose in the annotated transaction.
The in-memory Undo chain is not persisted in `.scanruler`.

## Integration boundary

The controller adapter and final worker-note/witness collection remain author's
work under `plugins/tmar-edit-surface/**`. This branch does not modify that subtree
or secretly bypass its note guards. `tests/fixtures/annotatedEditorProbe.tsx` is an
explicit source-only QA controller, never registered/imported by production; it
verifies the REAL host through real OCCT and native Save/Load, not the completed
Edit Surface adapter. The saved result is separately reopened/resaved in the
normal compiled app with no injected controller.

See `annotated-cad-copy-v1-validation.md` for precise checks and evidence. Note
transactions do not imply parametric `surfaceEdit`, recipe persistence, QS parity,
Patch Network completion, all topologies or a desktop-package release.
