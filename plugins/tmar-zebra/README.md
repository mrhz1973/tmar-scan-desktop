<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Zebra surface analysis

In **Reverse engineer**, open **Zebra surface analysis** and check **Show zebra
stripes**. Analyze visible CAD bodies, the bodies selected in the body list, or
the visible scan. Set stripe direction, width and color; rotate the view to
inspect how bands pass over neighboring surfaces. **Add note on the part** pins
a written observation on a body or the scan while stripes remain visible. Notes
are saved with the project and can be used without an agent connection. Turn the switch off to restore
the original appearance. Leaving the workspace also puts the analysis away.

Zebra uses a temporary rendering layer; it does not change, export or save CAD
geometry, scan geometry, materials, body visibility or history. Starting a CAD
editor also closes the analysis. It depends on
the `reverse` plugin and the `reverse.analysis` panel extension. With reverse
disabled, this plugin contributes no controls. A build without this plugin
leaves the host's analysis slot empty.

The stripes use the displayed mesh's interpolated normals. Coarse tessellation,
scan noise, missing normals, coincident objects and occlusion can change what is
visible. The effect is a qualitative visual aid, not a numeric measurement or
proof of G1/G2 continuity. The comparison map is a different tool. The overlay
is opaque while enabled; the source object's appearance is unchanged and comes
back on exit. The reflection formula and pattern derive from the owner's
SurfaceLab Zebra implementation. Exact parity with any other application has
not been established.

## Checks

```bash
npx vitest run plugins/tmar-zebra/tests/zebra.test.ts
node plugins/tmar-zebra/scripts/e2e-zebra.mjs
node scripts/check-plugin-boundary.mjs
node scripts/check-units.mjs
```

The browser check uses generated shapes and a fresh, isolated Chrome profile.
It starts a local server unless an explicit `APP_URL` is supplied; never point
it at a user's active session because the scenario replaces its test project.
The check is registered through `ci.json`. Windows/Chrome was exercised; a
real scanned part, macOS, a full continuity benchmark and live agent services
remain unqualified. Temporary browser-profile removal can be delayed by
Windows file locks; the check reports a cleanup warning if this occurs.
