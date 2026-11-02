<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# CAD face edges with Zebra

**Implemented in the web source; owner review remains open.** This is a display
control, not a geometry-repair tool or a continuity/accuracy certificate.

## Use

In **Reverse engineer** or single-view **Surface Deviation**, use the lower
**CAD edges** button (Show CAD edges). Its adjacent settings key scrolls to the
panel with **Edge color** and **Thickness** (1–6 screen pixels). The checkbox
and quick button share one state. Defaults: enabled, dark edges, 2 px. Browser
preferences remember the style; source/project geometry is never modified.

For an editable CAD body, **Tangent / fillet edges: Drawn** includes the boundaries
of tangent fillets. **Dimmed** and **Off** reuse the existing body setting. This
setting previously lived under **Bodies > Tangent edges**; it was not a triangle
wireframe control. Selection/hover highlights remain independent of resting edges.

The new controls reuse native body edges and silhouettes. Zebra previously wrote
its fill in front of those lines. A shared depth ordering now keeps the visible
face boundaries above the Zebra fill while preserving depth-tested hidden lines.
Disabling Zebra restores shading; disabling CAD edges only hides resting outlines.

## STEP opened as Scan

STEP opened in the main Model slot is now covered too. Leave **Analyze: Scan**
and enable **Show CAD edges**; color and 1–6 px width apply to the original STEP
face boundaries and silhouettes. The panel confirms **STEP loaded as Scan**.
No manual reimport as a CAD body is required. This preserves the STEP boundary
metadata but does not turn the displayed scan into an editable CAD body.

Boundaries follow the scan alignment and clipping, survive a shading resplit
and are regenerated on project reopen. Mesh replacements and edited previews do
not inherit obsolete CAD edges. Original scan data and source files are unchanged.
Native body-only tangent controls are not shown when no CAD body exists.
See [the regression record](../../docs/tmar-step-scan-validation.md).

## STEP reference

Load STEP through the reference slot in Surface Deviation. The importer retains
boundary segments by source STEP face identity: two neighboring triangles of the
same CAD face do **not** create an internal line. Boundaries between tangent faces
and open face boundaries are retained. Curved silhouettes follow the camera.
The existing tessellation positions, indices and measurements are unchanged.

Zebra is also available in this single Deviation viewport, with **Analyze:
Reference (STEP / mesh)**. Hide the scan when it obscures the reference. Zebra
replaces the target's shading temporarily, not numerical comparison values;
turn it off to read the deviation colors. Boundary geometry is regenerated from
the original STEP when a project is reopened, not added to the saved CAD model.

An STL or other mesh-only reference has no CAD face identities. The control
explains that limitation; it does not invent CAD topology or enable triangle
wireframe. Original STEP loaded as Scan is supported through its preserved
face metadata; ordinary mesh files cannot supply that metadata. The existing
**Mesh** control remains separate.

## Notes, selection and limitations

Picking still reaches source bodies/meshes, not the line layer. Local notes,
Go to note/highlight and project round trips continue to work without enabling
an agent. Deviation note insertion remains **scan-side**, not reference-side:
with only the reference visible the note action explains/guards this boundary.
Split view, alignment picking and deformation animation are explicitly guarded
for Zebra; split-view notes remain planned separately.

Silhouettes and curved boundaries are sampled display lines, not exact curve
exports. Visibility can depend on tessellation, clipping and overlapping objects.
No generalized QuickSurface parity, macOS qualification or final owner approval
is claimed. See [actual checks and comparison limits](../../docs/tmar-cad-edges-validation.md).

## Implementation and checks

`CadEdgeControls.tsx` exposes `view.tools`, `reverse.analysis` and `deviation.extra`.
`ReferenceEdges.ts` owns only its render resources. `edgePrefs.ts` validates settings.
Dependency: `reverse` for existing body-edge/picking and silhouette facilities.
Generic host additions transport optional STEP boundary metadata and expose the
borrowed reference; the host never imports this plugin by name.

```sh
npx vitest run tests/cadBoundaries.test.ts plugins/tmar-cad-edges/tests
npm run build
node plugins/tmar-cad-edges/scripts/e2e-cad-edges.mjs
node plugins/tmar-cad-edges/scripts/e2e-cad-edges-production.mjs
```

The first browser script creates the generated project used by the compiled test.
`REAL_STEP` optionally selects an authorized local STEP for private checking;
no model bytes or private screenshot are committed. Use isolated test profiles,
never a live user tab. No dependency, kernel or saved project schema is changed.
