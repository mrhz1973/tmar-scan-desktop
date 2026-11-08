# Detached rim clamping — experimental checkpoint

Date: 2026-11-08, Europe/Rome. Base: `82942bf36c33ec20ed3793bb42b0f72ab3cec6d5`.
Branch: `codex/edit-surface-tubo-periodic`. Runtime: `occt-wasm@5.7.1`.

## Scope and provenance

The reconciled checkout contained an unpublished detached-face adapter and
its synthetic test, in addition to the separate Spiana WIP and private Tube
tests, markers and receipts. This checkpoint resumes that adapter. The other
WIP and all consumed real-data attempts remain separate and unchanged.

`clampExperimentalDetachedBrepRim` rewrites one uniquely matched, uniquely
edge-owned polynomial 3D B-spline curve record in a detached OCCT BREP V3
face. It uses the existing exact-rational clamping helper and requires zero
binary64 coefficient error. Existing edge and pcurve ranges must match the
requested interval. The pcurves, supports, references, tolerances and topology
outside that curve record are preserved as text. Unsupported representations
are refused; this is not a general BREP parser or a new geometry solver.

The resumed adapter now also refuses vertices with parametric representations.
OCCT can store a PointOnCurve reference from a vertex into the same Curves
table, independently of the Ed records. Counting only edge owners would miss
such a reference. This checkpoint accepts only an empty vertex representation
list, followed by `0 0`; it does not add vertex-parameter remapping.

This is an experimental helper, not wired into the worker or UI. It does not
qualify a real Tube edit, a complete solid, continuous G1, volume, thickness,
self-intersections, production host behavior or a release.

## Focused verification

The resumed test stages the protected face through the actual string adapter,
rebuilds its synthetic neighbor, sews the pair and exports/reimports STEP in
memory. It checks both native pcurve-to-support associations, their parameter
maps, shared-edge multiplicity, opposite edge uses, face orientations, ranges
and tolerances. The other native 3D curves of the protected face must match
their pre-edit values. The original protected face remains unchanged.

The fixture uses a quadratic nonclamped polynomial rim, two distinct U
domains and a shared range `[-2, 13]`. After STEP readback, the explicitly
specified equivalent periodic representation is allowed. This does not infer
equivalence for an arbitrary imported curve.

Executed once after the adapter correction and test extension:

```text
node node_modules/vitest/vitest.mjs run plugins/tmar-edit-surface/tests/experimentalDetachedBrepRimClamp.test.ts --maxWorkers=1 --no-file-parallelism --reporter=verbose
```

Result: one integrated synthetic test passed, including explicit refusal
assertions for a parametric vertex, ambiguous edge ownership, mismatched
edge/pcurve range and an unsupported curve record. The 65-parameter maximum
edge-to-support gap was `2.808666774861361e-15 mm`, before and after STEP
readback. Edge tolerance remained `1e-7 mm`; the reopened curve was periodic.
Receipt: `evidence/detached-rim-clamp-20261108/attempt-1.json`.

The focused TypeScript result is recorded separately in
`evidence/detached-rim-clamp-20261108/typecheck.json`; it covers the adapter
and test import graph, not the complete host.

## Next real applicability check

The Tube owner must match existing evidence for **323/V0 adjacent to 324**
to this helper's domain: exact source curve coefficients and active edge
range; both support/pcurve associations and maps; unique curve ownership;
vertex representation lists; unlocated detached-face topology; and the
unchanged tolerance and clamping preconditions. Do not confuse this edge
with **323/V1 adjacent to 322/V0** or cut the inactive padding knots directly.

Use existing manifests/receipts first. This checkpoint does not rerun the
consumed topology manifest or any refused real-data attempt, and does not
authorize a real candidate. The Tube chat retains the real-part execution;
the host coordinator retains integration, kernel changes and release.

## Kernel comparison remains separate

The source comparison of occt-wasm 5.7.1 and 5.15.0 found a new coefficient
surface constructor in 5.15, while `makeBSplineEdge` already exists in 5.7.1.
This does not provide native setters for both preserved pcurves or qualify
replacement of the complete topology. The newer package also changes mass
property integration for freeform surfaces, so changing packages would not
be a neutral substitution for the existing volume guard. No dependency,
lockfile, MCP or host update is included here.

Primary references read for this checkpoint:

- Existing clamping and cubic rim fixture at base commit `82942bf`.
- OCCT `BRepTools_ShapeSet.cxx`, `WriteGeometry` and the vertex representation
  format: https://github.com/Open-Cascade-SAS/OCCT/blob/c7f60ffe85f28c67358d1771454044f0521f2fdd/src/ModelingData/TKBRep/BRepTools/BRepTools_ShapeSet.cxx
- occt-wasm version comparison: https://github.com/andymai/occt-wasm/compare/v5.7.1...v5.15.0
- occt-wasm changelog at 5.15.0: https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/CHANGELOG.md

Integration, merge, distribution and release remain **HOLD**.
