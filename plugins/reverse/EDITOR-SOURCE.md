<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Current CAD input for editors

2026-11-03. Host-side read contract; no transactional Apply or persistent face identity is implied.

## Call

```ts
const result = await runCommand('reverse.body.edit_source', {
  body: currentBodyId,
  // Optional optimistic preconditions from an earlier read:
  // expectedKey: previous.source.bodyKey,
  // expectedBuildVersion: previous.source.buildVersion,
})
```

The explicit numeric ID must identify a body in the **current settled build**.
Ordinary open sheets, sewn sheets, and solids are supported. Visibility does not
filter an explicitly requested body. Missing IDs do not fall back to aliases,
other bodies, the original imported file, or a mesh.

The result has `version: 1`, `file: {name, mimeType: 'model/step', bytes: Uint8Array}`,
and `source: {bodyId, bodyKey, buildVersion, kind: 'surface' | 'solid', faces,
closed, units: 'mm', coordinateFrame: 'part'}`. `status` is informational.
The existing file-result decoder can consume `file` without a new file format.

The STEP represents the built body, including upstream modifications, in the
host part frame. It does not bake in a viewport/camera transform. Once imported
by an editor, this STEP is that editor's `imported-step` coordinate frame.
Use the host's same frame for any eventual verified Apply transaction.

The host checks its source key in the CAD worker and checks document/build state
again after the asynchronous read. A replaced source, rebuild, changed alignment,
missing body, or changed kernel/session is rejected rather than returning stale
CAD. `bodyKey` and `buildVersion` are session-local optimistic guards: **not durable
project/face IDs and not a mutation lease or authorization token**.

## Deliberately separate from Export STEP

`reverse.export.step` and `Builder.stepBodies` are unchanged. They still exclude
ordinary sheets according to the existing deliverable-export policy. Do not
broaden that filter to make editor loading work, and do not retry general export
on failure as an ambiguous fallback.

This path uses the base STEP writer on the current CAD shape, not the automatic
export-gap-repair pass (`exportStepMended`). It does not sew, thicken, solidify,
heal the in-memory body, create features, change notes, or add history entries.
The base writer's existing STEP serialization corrections are retained.
Pending host builds may be settled before reading, as with other read commands.

## Edit Surface integration boundary

The editor author owns `plugins/tmar-edit-surface/**`. Its `Carica corpo` action
must switch from `reverse.export.step({bodies:[id]})` to the call above. This host
increment does not rewrite that plugin or claim its button has already switched.
The separate `Apri STEP` path remains available.

This read contract does not implement `reverse.surface.applyCopy`, annotated
Apply, `surfaceEdit` feature history, automatic note remapping, or recipe project
persistence. Those remain distinct acceptance gates.

## Checks

`reBodyEditSource.test.ts` exercises the real command/session/service/OCCT path:
a hidden ordinary sheet; unchanged general export, notes and history; moved current
CAD rather than the import file; key/version refusal; solids; malformed/missing IDs;
and document resource replacement during a read. `reBodyEditSourceClient.test.ts`
covers worker timeout configuration, overtaken replies and mismatched body identity.
Browser qualification and exact tested revisions are recorded separately in PR #14.
