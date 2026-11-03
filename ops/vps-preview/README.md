# TMAR ScanRuler — VPS web preview (isolated)

Status: deployment package **proposed** on `ops/vps-preview-20261103`.
The intended preview host is `https://scanruler.31-70-139-73.sslip.io/` on the
user's IONOS VPS. This is a test-only, publicly reachable static web app; do not
place credentials, private scans, Airbox/STL2 files or customer data in the
served directory.

## Isolation and update policy

- Application repository: `mrhz1973/tmar-scan-desktop`.
- Source version: **latest `main` commit passing on-host `npm test`,
  plugin-boundary/unit checks and `npm run build`**. Unmerged Codex branches
  are deliberately excluded. Existing users are never reloaded by the server.
- GitHub's `ci.yml` exists but initially had **zero recorded workflow runs**;
  do not claim CI protection until an actual successful run is verified.
- Every 15 minutes, `tmar-preview-build.timer` checks for a newer commit.
  The unprivileged `tmar-preview` user builds a *candidate* in a separate
  directory; it changes the `current` symlink only on successful tests/build.
- Releases are immutable at `/opt/tmar-scanruler-preview/releases/<sha>/`.
  If a build fails, the prior release remains live; failures are in
  `journalctl -u tmar-preview-build.service`. No automatic restart of
  active CAD browser tabs or project migration.
- The static service binds **only** the Docker host bridge
  `172.20.0.1:8095`; the already-existing public Caddy container proxies
  an additional hostname. Existing Tailscale Nginx, ORS, catalogo, n8n and
  TecnoOne site configurations must remain unchanged.
- No server-side MCP agent and no stored project files are included.
- Browser-side project saves stay on each computer; users should export
  checkpoints before deliberately reloading into a new app version.

## Ten generated test fixtures

Fixture generator: `generate-fixtures.py` (stdlib only, no proprietary models).
Every fixture is a deterministic **closed manifold binary STL** with millimetre
units, validated triangle edge incidence, outward orientation and volume.
The webpage also provides `manifest.json` with SHA256, triangle counts,
volume, expected task, and dimension.

| Case | What to test |
|---|---|
| 01-planar-plate | Flat datum, section, 2D Sketch dimensions |
| 02-linear-ramp | Inclined plane fitting and angle |
| 03-diagonal-ramp | Oblique cuts and profile alignment |
| 04-convex-dome | Freeform surface, Zebra continuity |
| 05-concave-bowl | Local fitting and deviation |
| 06-saddle | B-spline / control-net fit |
| 07-raised-ridge | Sharp feature preservation and sectioning |
| 08-twin-bosses | Independent local regions, remodelling |
| 09-central-pocket | Flatten/raise/deviation |
| 10-sinusoidal-wave | Zebra bands and smoothing |

Path when deployed:
`https://scanruler.31-70-139-73.sslip.io/samples/tmar-tests/`.

**Limitation:** these STL files are scan-side meshes. The requested
**Edit Surface of an imported STEP B-Rep face is not tested by STL fixtures**.
The SurfaceLab/2D Sketch agent must supply a separately licensed parametric
STEP fixture and a verified round-trip test for that feature. Do not claim
QuickSurface-like CAD face editing is qualified without that result.

## Codex coordination contract

**Chat "2 - SurfaceLab Imple Codex 1 2D Sketch"**
- Own Edit Surface / B-spline control/2D sketch CAD correctness on its
  existing branch, not VPS administration.
- Provide one genuine STEP body fixture with controllable faces and a
  reproducible edit test: select imported face, adjust intended surface,
  verify seam G0/G1, closure and STEP round trip; surface replacement is not
  silently considered the same as direct pole editing.
- Do not merge or alter CAD methodology without the user's explicit approval;
  stop on an impossible section-first route according to `dev-method`.

**Chat "ScanRuler TMAR App Desktop"**
- Own application web integration and the test gallery: load the ten STL
  specimens; exercise import/section/Zebra/smoothing/notes/2D Sketch and
  the build metadata. Review/extend regression tests.
- Keep desktop installer roadmap distinct from this static web deployment.
- Coordinate with Edit Surface branch before merging interface changes.
  Do not reload current CAD sessions.

**VPS preview owner**
- Own only isolated deployment, rollback and synthetic samples.
- Announce web build SHA, test status and known limitations; never silently
  publish unmerged branches. Keep existing sites untouched.
- PR merging into `main` is a separate explicit review action.

## Operator commands

After the initial installation:

```bash
systemctl status tmar-preview-http.service
systemctl status tmar-preview-build.timer
systemctl show tmar-preview-build.service -p ActiveState -p Result
journalctl -u tmar-preview-build.service -n 120 --no-pager
cat /opt/tmar-scanruler-preview/current/tmar-preview-version.json
ls -l /opt/tmar-scanruler-preview/current
```

Safe manual update check (runs tests, will not publish a failing candidate):
`systemctl start tmar-preview-build.service`.

Rollback is an **operator** action only: select an existing release directory,
verify the target and atomically replace the `current` symlink. Do not clean
releases or overwrite old projects as a side effect.

Caddy configuration snippet: `caddy-snippet.conf`. Validate the combined
configuration before a graceful Caddy reload. Keep a backup of the original
Caddyfile; do not restart the site's other containers.
