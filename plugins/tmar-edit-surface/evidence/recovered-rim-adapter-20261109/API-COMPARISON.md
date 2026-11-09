# API comparison for isolated rim materialization

Date: **2026-11-09**. Scope: source inspection only; no installation, kernel execution, CAD access, or tests were performed for this comparison.

## Versions and ownership

- Working checkout: **ScanRuler 0.9.4 / occt-wasm 5.7.1**. This note changes no dependency or host contract. The baseline package manifest was inspected at plugin checkpoint `82942bf36c33ec20ed3793bb42b0f72ab3cec6d5`.
- Compared upstream: **ScanRuler v0.9.10**, commit `28e0a100aaf6f1440e0a728eb49f77bed466b3fa`, published on 2026-11-08; its package manifest still selects **occt-wasm 5.15.0**.
- Compared kernel sources: **5.15.0** at `bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6`; previous **5.7.1** at `9892357968bc6ef0b52b98d20620a3f9c2385bc9`.
- These are source/package identities, not evidence of an installed 5.15.0 runtime or a qualified host/plugin pair. Host, kernel, MCP, merge, and release decisions remain with the coordinator.

## Existing reuse and remaining gaps

| Concern | Confirmed API or implementation | Reuse decision |
| --- | --- | --- |
| Binary BREP | `ReKernel.toBrep(shape): Uint8Array` and `fromBrep(data): Shape` delegate to `toBREPBinary` / `fromBREPBinary`. | Already present in upstream 0.9.4, unchanged in 0.9.10. Reuse for isolated shape transport; this is not the text V3 representation rewritten by the rim adapter. |
| Build transfer | `writePart(...)`, `readPart(...)`, `Builder.exportPart(...)`, and `Builder.offer(part, source)` carry binary BREP, tokens, and build state. | Existing transport avoids a second serializer. Face origins are remapped by face order with a count check; this is not arbitrary replacement of a face support or a proof of preserved topology. |
| Local test transport | `localKernel(load?, helpers?): ReTransport` supplies `ReClient` through `createReService(...)` without browser workers. | Reuse the existing isolated protocol harness where that protocol is what the test must exercise. It does not add missing CAD operations. |
| Exact surface construction | Package 5.15.0 adds `OcctKernel.nurbsSurface(data: NurbsSurfaceInput)`, including poles, knots, multiplicities, optional weights, and U/V periodicity. | Useful for constructing a new support after separate kernel qualification. Upstream 0.9.10 does **not** expose it through `OcctLike` or `ReKernel`. |
| Host surface construction | `ReKernel.surfaceThrough(points, rows, cols)` still calls `bsplineSurface` / `PointsToBSplineSurface`. | It approximates a sampled grid; it must not replace coefficient-preserving construction. This method is unchanged from upstream 0.9.4. |
| Native curve construction | `makeBSplineEdge(poles, weights, knots, multiplicities, degree, periodic?)` already exists in package 5.7.1 and in `OcctLike`. | Reuse where applicable. It creates a new edge; it does not attach two existing pcurves or preserve an imported edge's identity and trim by itself. |
| Native pcurve / reshape | The inspected package 5.15.0 public/raw interfaces expose no setter for two native pcurves, `UpdateEdge`, or `ReShape`. | The coordinated 3D curve / pcurve / support replacement gap remains. No native operation is inferred from its existence in OCCT C++. |
| Host protocol | `ReWorkerRequest` has no arbitrary BREP replacement, coefficient-surface edit, or pcurve/reshape request. The general plugin API supplies registration and UI hooks. | Upgrading the upstream app does not supply the missing Edit Surface contract or qualify the fork's separate host extensions. |

## Representation-preserving limits

`nurbsSurface` constructs a new face over the support's natural domain. Its arguments do not include the imported wires, edge uses, or pcurve associations. It therefore addresses support construction, not the complete replacement operation.

Package `edgeOnSurface(face, points, tolerance, closed)` first approximates 3D points, projects a curve onto the surface, and builds its 3D representation. It is not an API for retaining a supplied native pcurve pair and its parameterization.

The upstream sewing methods are also unchanged from 0.9.4:

- `sewSheet(...)` and `sewPatches(..., false)` use native sewing without a subsequent explicit healing/unification call.
- `sewPatches(..., true)` may call `healSolid`.
- `sewFaces(...)` may call both `healSolid` and `unifySameDomain`.

These wrappers are not interchangeable with a test that must attribute its result to the exact clamp and the explicitly selected sewing operation.

## STEP export behavior

`ReClient.exportStep(...)` and `exportStepChecked(..., false)` still reach `Builder.exportStepMended(...)`; `verify: false` does not disable that path's corrections. `ReKernel.exportStep` can apply torus-loop and small-conic corrections, and `exportStepMended` can additionally adjust curve ends after detecting small openings.

For the plugin's controlled representation check, retain the already selected direct `OcctKernel.exportStep` / `importStep` path. A successful host export that may mend its output is different evidence from an unmodified native round trip.

## Volume evaluator differences

Between package 5.7.1 and 5.15.0, the native implementation changes: from 5.9.0, freeform faces use an adaptive integration path (`kAdaptiveEps = 1e-8`) instead of only the previous direct `BRepGProp::VolumeProperties` call.

The host adds a separate distinction: `ReKernel.volume()` uses the native value, cached by shape handle in 0.9.10; `measuredVolume()` may use a mesh value when the discrepancy exceeds `5e-3`. STEP comparison has its own mesh fallback when native source/readback values differ by more than `1e-3` of the source magnitude. Those fallback thresholds already existed in upstream 0.9.4.

These are different measurement paths, not new Tubo requirements. This comparison neither explains an earlier real STOP retrospectively nor authorizes changing the plugin's guards or evaluator.

## Consequence for the next isolated check

Reuse the existing clamp, native BREP/STEP operations, and scoped representation checks. No new upstream 0.9.10 worker API eliminates the current rim adapter's task. Structural applicability and materialization/readback are recorded in their own receipts; neither outcome follows from this API review. No 5.15.0 runtime PASS or real-candidate qualification is asserted here.

## Immutable primary sources

- [Baseline package manifest](https://github.com/mrhz1973/tmar-scan-desktop/blob/82942bf36c33ec20ed3793bb42b0f72ab3cec6d5/package.json).
- [ScanRuler 0.9.10 package manifest](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/package.json) and [general plugin API](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/src/plugins/api.ts).
- [ReKernel](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/kernel.ts) and [OcctLike](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/occtTypes.ts).
- [Build transfer](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/buildTransfer.ts) and [Builder](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/build.ts).
- [Local transport](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/reLocal.ts), [worker service/protocol](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/reService.ts), and [client](https://github.com/CNCKitchen/ScanRuler/blob/28e0a100aaf6f1440e0a728eb49f77bed466b3fa/plugins/reverse/core/reClient.ts).
- [occt-wasm 5.7.1 public wrapper](https://github.com/andymai/occt-wasm/blob/9892357968bc6ef0b52b98d20620a3f9c2385bc9/ts/src/index.ts).
- [occt-wasm 5.15.0 public wrapper](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/ts/src/index.ts), [input types](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/ts/src/types.ts), and [raw API](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/ts/src/raw-types.ts).
- [Native constructors](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/facade/generated/kernel.cpp), [adaptive integration](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/facade/src/kernel.cpp), and [release history](https://github.com/andymai/occt-wasm/blob/bce9299aa7e7bd85f9e6c0e6aeae30f655d98ef6/CHANGELOG.md).
