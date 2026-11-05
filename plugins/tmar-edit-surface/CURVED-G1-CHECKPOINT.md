# Curved-support G1 research checkpoint

An isolated mathematical helper proposes and validates G1 along a straight natural common edge of compatible, nonrational clamped B-spline patches. It changes the selected patch's first interior row only and rejects locks, incompatible bases and cases where regularity cannot be certified conservatively. It is not connected to the CAD editor, worker, recipe, or user interface; CAD topology and preservation must be checked by a future caller.

Eight mathematical tests and three real-OCCT fixture tests passed. The fixture's support normal varies along the shared edge; after correction, the sewn STEP shell remains valid and 33 independent samples show seam position deviation below 1e-8 mm and sine of normal angle below 1e-9. These sample results concern only the synthetic fixture. The helper's conservative coefficient bounds cover its compatible mathematical class, not arbitrary NURBS, trimmed surfaces or global model G1.

The next integration requires independent topological identification of the support and natural edge, CAD readback and preservation of nonselected faces, session identity, Undo/Redo, recipe replay and UI verification. No QuickSurface parity or production feature is claimed.
