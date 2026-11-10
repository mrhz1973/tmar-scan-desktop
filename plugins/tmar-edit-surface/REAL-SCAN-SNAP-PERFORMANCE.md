# Real-scan snap-index cost, isolated check

On 2026-11-06, the owner's `Mesh 0923_1 (0.30mm) Airbox Lancia Delta Integrale ridotto del 75%.ply` was read without writing it. SHA-256 of the input bytes: `5f66eeac7e51a3dfa5a6b7faaacf6ccf4a827e36a898e9ff0df558d32a98c0a9`; 42,758,507 bytes; 1,706,336 triangles.

Node loaded the PLY with Three.js PLYLoader, then built two independent `three-mesh-bvh` MeshBVHs with `indirect: true` over the immutable position/index buffers, like the pick-only wrapper in `workspaceLayer.ts`. On this machine the builds took **784 ms** and **727 ms**. The automatic partial-retry test for `a7a7e26` independently verifies that the unchanged reference's position attribute is not read again; it therefore avoids constructing that target again. It does not time the retry or measure frame latency.

This is an isolated Node measurement, not a browser, packaged desktop, real user drag, end-to-end responsiveness, or a comparison with QuickSurface. It does not establish behavior under memory pressure or when geometry changes. No geometry file or active project was modified. Qualification of the exact integrated host and user-facing fluidity remains open.
