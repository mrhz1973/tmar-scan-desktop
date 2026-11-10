# ScanRuler TMAR — Native sewing lineage contract, experimental design
Date: 2026-11-07. Status: **HOLD / host research only**.
Base: host PR #39 `b11ad183ad8393c66554957eb7d453132fab385f`.

## Ownership / no integration
- This design belongs to the host/kernel owner (`plugins/reverse/**` and `docs/coordination/**`).
- No changes under `plugins/tmar-edit-surface/**`, `src/viewer/**`, user projects, or the separate Tubo Finale session.
- No shipped `sewWithHistory` feature, no UI, no Apply path, no feature-graph registration, no release.
- Plugin's shared-plane geometry and its pcurve ambiguity are NOT fixed by this proposal.

## Verified dependency limitation
Installed ScanRuler uses `occt-wasm@5.7.1` (both `dist/index.d.ts` and `dist/raw-types.d.ts`), exposing `sew`, `sewAndSolidify` but **not** `BRepBuilderAPI_Sewing::Modified` / `ModifiedSubShape` or a sewing-history export. Upstream `andymai/occt-wasm` generates its C++ facade and Embind interface from `xtask/src/codegen/config.rs`. Its `facade/generated/kernel.cpp` currently constructs `BRepBuilderAPI_Sewing`, calls `Perform`, returns the sewed shape or a solid, then discards the sewing instance without exporting provenance. Merely adding TS declarations in ScanRuler would fabricate a capability.

Open CASCADE C++ offers `IsModified`, `Modified`, `IsModifiedSubShape`, `ModifiedSubShape` and a sewing `GetContext`. For individual faces and edges, `ModifiedSubShape` via the reshaping context is the relevant operation. It is not the same API or semantics as the `Modified()` list on `BRepBuilderAPI_MakeShape`.

## Proposed native binding (not implemented)
A future audited wrapper build could expose:

```ts
type NativeSewingResult = {
  result: ShapeHandle
  stage: 'post-sew-pre-heal'
  inputFaceCount: number
  outputFaceCount: number
  relations: readonly {
    inputFace: number
    outputFace: number | null
    relation: 'unchanged' | 'modified' | 'deleted' | 'unresolved'
  }[]
}
sewWithNativeHistory(faces: ShapeHandle[], toleranceMm: number): NativeSewingResult
```

A **single native C++ operation** must:
1. Enumerate and retain the input faces and their topological identities *before* sewing; validate face handles, order, units and tolerance.
2. Construct and execute `BRepBuilderAPI_Sewing` once. Before the sewing object is destroyed, query `IsModifiedSubShape` / `ModifiedSubShape` for every input face (and edges if required). Consult `IsModified`/`Modified` only with their documented shape-level semantics.
3. Enumerate faces of the exact `SewedShape()` and map native original/modified `TopoDS_Shape` objects to resulting faces using genuine topological identity (`IsSame` / `IsEqual`, with orientation checked). A returned modified face not present in the output is **unresolved**, not matched by nearest centroid or face-index similarity.
4. Export the result shape and the mapping **atomically**, with output handles/ordinals scoped solely to that specific returned result. Release temporary native references on success and every failure.
5. Expose deleted, merged, split, or unresolved cases honestly. Never silently turn absent native data into `tracedHistory()` or face-order matching.

Healing, `unifySameDomain`, transformations and STEP export/import are **different topology stages**. A valid mapping immediately after sewing does not survive them automatically; either provide separately qualified native lineage for each subsequent stage and compose it, or return HOLD.

## Host structural preflight now authored
`plugins/reverse/core/nativeSewingLineageContract.ts` contains:
- `supportsNativeSewingLineage(kernel)`, which reports **false** on the installed wrapper.
- `screenNativeSewingLineage(trace,editedFace,protectedFaces)`, a strict **structural-only** screening of a future native trace, not a BREP/geometry verifier or proof of native provenance.
- Strict V1 scope: 1:1 face mapping, all inputs/outputs accounted for, exactly one edited face, complete protected-neighbor set, no duplicate output, no deleted/unknown face, no post-healing trace.
- Returns `refused` for ambiguity; never authorizes publication/Apply.

The screening input is structurally forgeable in JavaScript; only the future native wrapper can produce authenticated operation-scoped evidence. Even then, matching provenance does **not** prove preserved surface shape, boundary curves, trimming pcurves, continuity or topology.

## Required QA before enabling anything
1. Real native wrapper build with locked source SHA, OCCT version, npm package SHA and completed C++/Embind/TypeScript build. No runtime monkeypatch or unsupported dynamic exports.
2. Split-top imported STEP fixture: 7 faces, 1 solid; record exact 1:1 native lineage of all 6 protected neighbors and edited face, including the 4 whose serialized BREP changes. Compare against source and output; reject if any is missing, ambiguous or represented by an unexpected split/merge.
3. Independent negative fixtures: two input faces mapping to one output, ambiguous orientation, deleted tiny face, shared pcurve changes, reordered faces, tolerance-driven joins, and shape modified again by healing. Fail atomically without user-project mutations.
4. Measure independent surface/boundary/edge/pcurve preservation, orientation, valid STEP roundtrip and tolerance budget. Zero or low sampled distance does not prove BREP identity.
5. Only after that design a revision-fenced host/plugin API, Undo/Redo, real project Save/Reopen and GUI. Keep `experimentalSharedPlane` UI disabled until all gates pass.

## What the current tests mean
`nativeSewingLineageContract.test.ts` checks one modeled 7-face native-trace structure, ambiguous or incomplete mappings, deleted/unknown faces and unsupported postprocessing. It additionally constructs a real seven-face split-top STEP solid with installed OCCT and confirms the **native history capability is missing**. This is NOT a positive real-native sewing-history test and is NOT authorization to integrate shared-plane.

**Decision: host contract prepared for review. Native C++/WASM binding and real ModifiedSubShape mapping are BLOCKED; shared-plane UI/Apply/persistence remain HOLD.**
