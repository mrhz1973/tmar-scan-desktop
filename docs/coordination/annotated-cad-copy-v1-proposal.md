<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Annotated CAD copy v1 — proposed transaction, NOT a runtime capability

2026-11-03, Europe/Rome. Separate proposal against frozen host a28c747591e740d62f3b1f90330f145141c77de1. The host still advertises only `cad-copy`; draft notes MUST continue to block Apply. No API signature, live store, plugin or frozen branch changes in this proposal.

## Inspected contracts and constraints

- Host: `src/plugins/workspaceEditorTypes.ts`, `workspaceEditors.ts`, `plugins/reverse/app/workspaceEditorHost.ts` and the published host v0.1 qualification record.
- `plugins/reverse/state/noteStore.ts`: notes intentionally live outside model Undo; `nextId` and note editing are separate state. Registering a whole-notes snapshot in geometry history would overwrite unrelated edits.
- `plugins/reverse/core/notes.ts`: a Note stores text, part-frame `at`, optional normal and `on` targets. Current CAD face attachment uses body ID plus FaceFingerprint, not a durable worker face index. `fromFile` is session-only provenance.
- `plugins/reverse/app/notesSection.ts`: project key `reverseNotes`, validation before loading, notes move with part alignment. A STEP export alone cannot carry these notes.
- Author checkpoint 0fb4aca30e66059fbdb9b4d5baa0f1d73105828a, `RECIPE-INTEGRATION.md`: final `noteResolve` and `finalFaceWitness` supply resolved anchors and an OCCT face BREP with preview/selection revisions. These are evidence to verify, NOT host persistent identities.

The reported Lego source-browser result belongs to the author; no coordinator rerun, user-file access or compiled integration is claimed here.

## 1. Additive capability and initial scope

Propose a separately negotiated `annotated-cad-copy` capability with annotation protocol version 1. Keep ordinary `cad-copy` and its payload/signatures unchanged. A future host/controller handshake can expose an OPTIONAL annotated preparation method; no plugin should import or call a runtime method from this proposal yet.

Initial supported draft target: **one verified face of the new CAD copy**, matching the selected edited face. Existing project notes on the original, scan or other bodies are preserved, NOT cloned or retargeted automatically. Draft notes on scan/external CAD, multiple edited faces and edges/vertices remain explicitly unsupported until separately advertised and qualified. Unsupported notes prevent Apply; no silent geometry-only fallback and no silent dropping of notes.

## 2. Envelope and freeze

An annotated Apply ticket binds operationId, complete host SourceBinding, exact validated PreviewStamp and `notesRevision`. Freeze includes geometry, face selection, locks/modes, text, anchors, addition/deletion and note metadata. Increment notesRevision whenever the note bundle changes; geometry validation alone does not prove the text bundle is unchanged.

The plugin prepares, without mutating project stores:

- standalone final STEP bytes in part-frame mm;
- all draft notes with unique draft IDs, original text and optional done/reply metadata;
- noteResolve results on that exact validated geometry: UV, position, oriented normal and the same selection/preview identity;
- selected-face BREP witness, content hash and same stamp.

The host checks finite coordinates, declared units/frame, witness/content hashes, duplicate IDs, text and payload size limits, completeness and consistency of note counts/revision. Empty/unsupported drafts produce a clear refusal; they are not filtered out without the person's decision. Text is content, never a command or an executable instruction. Do not persist session IDs, request IDs or selection revisions as project topology identity.

`annotated-cad-copy-v1.types.d.ts` supplies proposal-only envelope types. Its type check does not validate hashes, geometry, identity or transaction semantics.

## 3. Stage body and exact final anchors without committed mutations

Retain current independent-kernel CAD staging. Before publication:

1. Validate exactly the final STEP, expected new body count and unchanged original bodies.
2. Import/validate the face witness independently. Build candidate faces from the NEW staged body only; the source body or a nearby other body is never an attachment fallback.
3. Match using verified import provenance when available. Otherwise use a deliberately conservative geometric witness: surface/trim topology, orientation, area and bounded geometry comparisons. Hash equality of independently serialized BREP or mere nearest centroid is NOT a proof; ordinary fingerprints can collide. No/ambiguous candidate means the whole transaction is refused. Record that geometric matching is bounded, not exact topological identity, and qualify supported surfaces before enabling it.
4. For the unique verified destination face, project the final resolved part-space position onto its exact CAD surface, recompute destination UV and verify trim membership, holes, distance and oriented normal. Do NOT copy source UV blindly: reimport may change parameterization or orientation. Reject a point in a hole, on the wrong coincident sheet or outside the declared tolerance. No tolerance widening on failure.
5. Construct NoteTarget from the HOST destination body/face fingerprint, alongside an attachment record scoped to a persistent import-feature UUID and verified final STEP resource digest. Worker indices are diagnostic only.

Tolerances must be explicit, scale/unit-aware and fixed for the validation run; agree them with kernel evidence, not an invented universal scanner accuracy. Required uniqueness/membership checks cannot be replaced with a looser mesh snap.

## 4. One publication, one receipt

Publication precondition checks occur AFTER every await, AFTER staging and witness/anchor verification, and under the same exclusive mutation gate immediately before the first committed change. Recheck documentEpoch, source/kernel/build/frame identity, exact preview stamp AND notesRevision. No await between final guard and publication.

Stage all note objects, attachment records, ID reservations, CAD resources and history delta before touching live stores. Publish the copy, its resources, managed notes/attachments and ONE project history action together. Cancel revokes the ticket before commit; a late prepared result cannot insert notes or body. If commit won already, return its receipt, never a false cancellation.

Current stores are separate Zustand stores. Two sequential setState calls are NOT by themselves atomic to subscribers. Add a host transaction coordinator/committed read view so model rendering, selection, save/recovery, commands and note observers cannot observe a half-published body/note set. Buffer or gate participating notifications, release one committed revision, and reject reentrant mutation attempts. `historyAtomic` alone does not establish cross-store observational atomicity. Do not suppress arbitrary observers globally.

Failure injection must prove restoration of source kernel/maps, reverse state, participating note state/IDs, attachments and history. Rollback must not overwrite a changed/replaced document. An actual document change inside a prohibited reentrant callback must be rejected by the gate, not repaired with an old snapshot over a new document.

Receipt: operationId, document identity, full envelope hash, CAD digest, created body identity, draftId-to-noteUuid/displayId mapping, attachment revision and historyActionId. Idempotency uses a hash of STEP bytes + canonical note/witness bundle + source/stamp/notesRevision; CAD hash alone would treat changed text as an identical retry. Same operation/hash returns the prior receipt; same operation/different envelope rejects. In-memory retention is not a claim of durable restart-safe retry.

## 5. Undo/Redo without losing unrelated note edits

Do not add the whole noteStore to the ordinary geometry snapshot. Introduce an operation-owned note delta/managed bundle and an atomic history action for the created copy plus that bundle.

- Commit allocates persistent note UUIDs and fresh display IDs only at publication. The allocation counter remains monotonic across Undo.
- Undo removes/deactivates only this operation's copy and ACTIVE owned notes. Before removal, capture their latest text/reply/done edits and explicit-deletion tombstones into this history entry's bundle; preserve unrelated notes byte-for-byte.
- Redo restores the copy and those latest owned-note values, not the stale text from the original Apply. Explicitly deleted owned notes remain deleted. Revalidate attachment identity and check display-ID collisions; never overwrite another note.
- If later unowned notes or dependent geometry refer to the copy, preflight that dependency before any mutation. Refuse an unsafe Undo with a clear diagnostic rather than deleting other people's notes or leaving an apparently valid orphan.
- An edit or deletion after Undo must not cause a stale snapshot to resurrect or erase notes. Redo pruning releases only resources owned exclusively by the discarded operation.

This needs a delta-aware history action and managed attachment lifecycle, not just another `registerHistory.capture` list. Existing local editor Undo remains separate until Apply.

## 6. Project persistence and reopen

Persist normal Note content through validated `reverseNotes`; add a versioned attachment section for stable note UUID, import-feature UUID/resource digest and destination face witness/fingerprint/UV. The exact section name must be coordinated before implementation. Preserve normal note fields and session-only `fromFile` treatment.

The project loader validates BOTH sections before mutating either store, remaps persistent feature/body identities to newly built runtime IDs, and resolves only unambiguous verified faces. A broken external edit or missing body is preserved as an explicit unresolved attachment, not silently moved to the nearest visible object. Ordinary native-file roundtrip must retain valid resolved anchors and text; corrupt/unknown required schemas must reject without replacing the current project. Saving an applied annotated copy does not persist Edit Surface's parametric recipe or local pole history.

## 7. Ownership and handshake

Plugin author: freeze/note revision, final worker resolution and witness, prepare envelope; UI retains draft and reports host refusal. Host coordinator: staging/matching, cross-store transaction, ID allocation, history delta, persistence, project invalidation and receipt. No parallel edits in `plugins/tmar-edit-surface/**`.

Do not change the fixed a28c747 capability while source/compiled plugin integration is being qualified. Implement annotated support only on a separate branch, communicate exact commits and negotiate the optional method before enabling it. Until then pending notes block Apply as today.

## 8. Acceptance matrix before capability enablement

1. Source and compiled browser: text entry during Zebra, pole drag and local Undo/Redo, final resolve, Apply; original preserved and new note on the copy.
2. Exact unchanged note text, done/reply and distinct numeric/persistent identities after project Undo/Redo, Save and new-page Open.
3. Notes on an unchanged original/scan/other body are untouched; unrelated edits made after Apply survive geometric Undo/Redo.
4. Final face reorder/reversed parameterization; unique face proof; synthetic coincident faces ambiguous; hole/trim exclusion; wrong normal/units/frame. All refused cases leave zero body/note/resource/history residue.
5. Held prepare, CAD stage, note resolve and identity matching -> Cancel/source change/same-ID new document -> release. No late publication.
6. Double Apply/retry; same CAD with different text; failure after each publication step; reentrant observer attempt; nextId preservation and ID collision. Never a half-visible state.
7. Note edit/delete after Apply and after Undo, unowned dependent note, redo branch pruning, closed session callbacks and scene cleanup.
8. User Lego file only on an authorized read-only copy, original hash unchanged; qualify separately from synthetic fixtures. No general QS parity, no guarantee on unsupported target types.

## Status of this delivery

Proposal plus standalone type declaration/probe only. No annotated host implementation, browser test, kernel face-match qualification or active-PC access in this turn. Host remains `cad-copy`; Versione 1 unchanged. Source references above were read through GitHub. Desktop access failed before any operational request ran; no Windows WIP or user project was touched.
