<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Smooth intensity and repeatable marked regions

**Web implementation; user review OPEN.** In **Mesh Tools > Smooth**, select
**Marked region**, mark the surface and press **Smooth the marked region**.
The same region remains selected after each successful application, so the
button can be pressed again without another brush/window/lasso selection.
**Clear marking** explicitly removes it. Each mesh edit has its own Undo step.

The optional **Intensity** slider ranges from **0% to 100%**. Changing it does
not modify the mesh: the Smooth action applies it. 0% disables the no-op button;
100% is the prior full smoothing result. Intermediate values blend that full,
bounded displacement with the input of this application. The setting is distinct
from **Smooth bumps up to** (patch size), **Move at most** (movement limit) and
**Keep sharp edges**. The displayed percentage is recorded with each edit and
saved in the project. Legacy settings without intensity read as 100%.

**Movement limits are per application, not a lifetime budget from the initial
scan.** Repeated applications are cumulative. Check the copy's numerical
**Deviation** against the scan before deciding to use it for analysis. Smooth
changes the existing edited copy; it does not silently adopt it as the source.

## Selection scope

The region is remapped using the smoothing result's exact old-to-new vertex map,
after the indexed PLY copy has been reloaded. Outside-region vertices stay fixed.
There is no guessed spatial reselection. Mesh replacement, topology changes,
changing marking tools, project reopen and Undo/Redo may clear transient marking;
this is not a named selection-set or cross-session selection-storage feature.
Failed operations do not publish a new retained selection.

## Modular implementation

`SmoothIntensity.tsx` is installed at the reusable `mesh.smooth.controls` slot.
Small Mesh Tools additions carry optional strength through its state, history,
command and project settings. The existing smoother adds only a final bounded
blend: its fitting, edge protection and regional falloff are unchanged.
The session retains the marking only for successful regional Smooth, not for
arbitrary topology-changing operations. `mesh.smooth` accepts `strength` in 0..1.

Tests cover 0/100% compatibility, intermediate displacement, limits, region
boundaries, vertex remapping, legacy projects, two real UI applications on one
marking, Undo/Redo and the compiled UI. See
[validation](../../docs/tmar-mesh-review-validation.md).
