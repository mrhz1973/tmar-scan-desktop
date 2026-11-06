# Shared CAD support: isolated experiment

The current editor deliberately refuses an ambiguous or shared serialized surface. `tests/sharedSupportFixture.test.ts` constructs an OCCT box, splits its top with an edge, sews a valid seven-face solid, exports and imports STEP, and reproduces the refusal on a top face. The original imported BREP remains unchanged.

The same test exports that face alone, edits an interior control pole by 0.02 mm through a separate `SurfaceEditorKernel` in G1 mode, and sews the resulting face together with the six original faces. On this synthetic planar case, the result and STEP round-trip are valid, contain one solid and seven faces, and have a detectable interior change. One central sample from each other face remains within 1e-6 mm of the resulting skin. This is a feasibility experiment, not a production editing path or QuickSurface comparison.

The current shared-support guard remains in place. Before integrating this method, independently check complete boundary and neighboring-face geometry, pcurves, orientation, self-intersection and tolerances, resource cleanup, failure atomicity, face identity, Undo/Redo, notes and a versioned save/replay contract. Sampling six face centers does not establish preservation of whole faces or global G1 continuity. General curved or rational faces, repeated STEP and application interaction remain unqualified.
