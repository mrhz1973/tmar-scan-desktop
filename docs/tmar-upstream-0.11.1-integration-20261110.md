<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# ScanRuler 0.11.1 with TMAR extensions — 10 November 2026

## Source baseline

The owner requested the complete official **ScanRuler 0.11.1** as the new base,
with the TMAR extensions reapplied above it. This is the source composition for
**TMAR Versione 4 · Anteprima**:

- Upstream tag `v0.11.1`, commit
  `aa28ffe632d06fd20ae35eb6c75bd1b0432d38e1`, published 9 November 2026.
- TMAR integration parent `099fe5493af3305ef8cae8fd385051b1b7a00277`, the
  Versione 3 source previously qualified on ScanRuler 0.9.4 / occt-wasm 5.7.1.
- Package version **0.11.1**, upstream-pinned **occt-wasm 5.15.0** and the
  upstream MCP package. The historical Versione 3 remains separately available.

The merge starts from the official tag. It carries all intervening upstream
changes, rather than selecting only release-note fixes. `README.upstream.md`
is the full README from that tag. The official release sections in CHANGELOG
remain intact beneath the fork's Unreleased entries.

## Upstream behavior retained

This includes the 0.11.1 worker-specific Content-Security-Policy corrections for
mesh booleans, Hollow and Trim to scan, and saved fitting guides used again
during project opening and re-fitting. The newer project schema and compatibility
checks remain upstream's. Older project data is handled by those readers;
the fork does not downgrade the project format or erase unknown fields to pass.

The external first-paint `theme.js` and the production CSP checker are retained.
TMAR's explicit dark default is implemented in that external script, alongside
the same preference semantics used by the hydrated application.

## TMAR behavior retained

- Workspace editor host, shared viewport, camera, pointer ownership and gizmo.
- Edit Surface's ordinary supported operations, CAD face duplication, saved
  parametric edits, archived source identity and atomic body/note/history Apply.
- **Mantieni la modifica riapribile**, `.scanruler` persistence and
  **Riprendi modifica**, within the supported recipe contracts.
- Zebra and CAD edges, local notes, grouped features, export and label controls.
- Display-unit conversion and conservative upper-bound display.
- Smooth intensity, explicit regional selection and temporary Shift navigation.

Mesh Tools retains upstream Mirror, Densify and Wrap together with those TMAR
controls. Upstream's targeted state subscriptions remain in place. Reverse
keeps its new commands and stale-response counters; adopting a prepared editor
kernel supplies topology before publication, while preserving rollback.

The history store keeps upstream memory budgeting and independent asynchronous
groups, together with the fork's native CAD/note deltas and compensation on
refused publication. The editor camera contract accepts the active upstream
camera, including perspective, without pretending it is always orthographic.

## Kernel and saved recipes

New recipes identify their actual 5.15 runtime. Historical 5.7 recipes are not
rewritten or relabelled. Any supported legacy replay must pass the same source,
base, geometry and independent native-readback checks; it is a compatibility
check of the new runtime, not a transfer of a historical PASS.

T2 periodic research, its saved targets/candidates and consumed proofs are not
part of this product merge. The Tubo's geometric qualification remains separate.

## Verification and delivery record

The final publication must include the exact source commit, clean build identity,
full CI outcome and explicit skips. Historical Versione 3 results do not qualify
this runtime. The pipeline retains all upstream gates, the CSP check, the
integrated editor browser checks and the upstream/plugin browser regression run.

Targeted migration checks cover the native history/annotation round trip,
legacy recipe compatibility, mesh state and units, perspective projection,
theme boot under CSP and regeneration of the MCP command list.

The downloadable delivery's VERIFICHE.md and the integration PR retain measured
results and negative receipts. Those records distinguish source completion,
build qualification and the revision actually published to the web server.

## Existing web hosting

The public selector and the two applications are separate services:

- `https://scanruler.31-70-139-73.sslip.io/`
- Stable at the same origin with `?version=stable`.
- Dev at `https://scanruler-dev.31-70-139-73.sslip.io/`.

The 10 November read-only check found Stable `935f07f` and Dev `4a93782`, both
0.9.4 builds from 3 November. The selector's requested `/launcher-version.js`
and `/tmar-live-versions.json` returned 404; its HTML already contained literal
question marks in place of accented characters. A new Git build alone is not
evidence that this separately hosted selector or either application has updated.

The existing operations runbook uses independent release directories and an
atomic `current` symlink. Deployment should preserve the previous release and
browser origins, then verify the public metadata against the activated bundle.
Do not substitute a Git branch tip for proof of the currently served revision.

The corrected UTF-8 chooser, same-origin metadata client, read-only aggregator
and isolated local server are reproducible in `ops/vps-launcher/`. Their six
targeted checks cover actual response fields, missing data, HTTP routes,
timeout/recovery and refresh without reloading an application. These candidate
sources have not been installed into the existing VPS launcher: its current
proxy and Python service configuration must be read before adapting the patch.
