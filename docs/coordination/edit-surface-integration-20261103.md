<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Edit Surface — bounded runtime integration review

Verified November 3, 2026, Europe/Rome, Windows/Chrome on ASUSDESKTOP.
**Isolated integration prepared; bounded runtime ACK. No main merge, full QS parity,
full host acceptance, qualified desktop release or user visual acceptance.**

## Revisions and ownership

Repository: `mrhz1973/tmar-scan-desktop`.
Review branch: `review/edit-surface-integration-20261103`.
Base main: `935f07f23a2311e8d90684590b8aac3d78ca0b5a`.

| Author checkpoint | Isolated cherry-pick |
| --- | --- |
| `c073fe8152fff0b8fb1b331f5283d29da041e2b3` | `7334f17a28934caad271ef07032aac4832090c7d` |
| `3b36a3626c2cf22be8e640a97c882594dcad4ea2` | `e7b71efdf43e6bf7bbb7604c540420f297d074d5` |

Both applied without conflicts. The clean tested runtime is `e7b71efdf43e6bf7bbb7604c540420f297d074d5`.
All 28 delivered files are inside `plugins/tmar-edit-surface/`; no host executable source changed.
The plugin subtree is identical to the author checkpoint: Git tree `0e750d2fcd7b100ebffcb03e0b90aade0c879032`.
Only this coordinator report and its JSON summary are added after runtime testing.
Exclusive plugin source ownership stays with the author on `codex/edit-surface`.

## Coordinator reruns

| Check | Result |
| --- | --- |
| Targeted unit tests, 9 files | 45 passed, including both submitted Edit Surface kernel tests |
| Whole-app TypeScript | PASS |
| Production build, including refined worker/WASM | PASS; process duration 19.205 s |
| Original editor browser flow on current host | PASS: STEP import, numeric displacement, actual pole drag, locks, local Undo/Redo, flatten/stretch/smooth, Apply and independent STEP reimport |
| Curved rational STEP/project round-trip in development app | PASS |
| Same round-trip in compiled app, public UI only | PASS; no development state globals or development command imports |
| Zebra regression | 32 browser checks passed |
| Compiled note focus/highlight, panels, Zebra entry | 31 passed |
| Category fixture/development scenario | 35 passed |
| Compiled categories | 22 passed |
| CAD edges fixture/development scenario | 25 passed |
| Compiled CAD edges | 9 passed |
| Compiled Mesh Tools review | 18 passed |
| Compiled Brush/Window/Lasso/Smooth/held-Shift | 49 passed |

Total: **221 logged browser regression checks**, plus three Edit Surface browser workflows and 45 unit tests.
Completed scenarios reported no application console errors. Build warnings for externalized dependency modules
and large chunks remain visible. These are local results, not hosted CI or full upstream-suite qualification.

## Compiled round-trip

The public-UI scenario opens a generated curved rational STEP solid, selects the eligible B-spline face,
exposes its single free interior pole after exact 4x4-to-5x5 initialization under G1 and moves it +3 mm in Z.
Apply creates a new CAD body. STEP is exported through the normal Export body dialog; Save downloads a
portable project; a separate browser page reopens it and exports STEP again through the same public dialog.
Independent OCCT reimport observed:

- Original volume: `6075.247994550057 mm3`.
- Edited and reopened/exported volume: `6192.107966783208 mm3`.
- Maximum difference on the six faces' 9x9 sampled positions: `0 mm`.
- Browser errors: none; scenario elapsed time `6580.192 ms`.

This is sampled fixture evidence, not scanner accuracy, proof of equality at every point,
exhaustive self-intersection certification or a speed benchmark. Compiled edit/reopen screenshots were
visually inspected. The original editor flow independently reimported its final result at `6147.519126596491 mm3`.

## Open inherited gate — not an all-green delivery

`node scripts/check-plugin-boundary.mjs` fails on this pre-existing reference:

```text
scripts/capture-tmar-gallery.mjs:11
../plugins/tmar-mesh-review/scripts/fixture.mjs
```

The same failure was reproduced on the unchanged pre-integration gallery tree, whose contents match
base main `935f07f`. The gallery script blob is `ecc08a4cfb059c3ab233241c0a0c27f55dc22213` before and after
integration. This is not an Edit Surface dependency. No checker exclusion, allowlist relaxation or source
workaround was introduced. A clean main-integration gate requires this separate coordinator issue resolved.

Initial compiled category and CAD-edge attempts lacked their generated `.scanruler` test fixtures.
Their normal synthetic development scenarios subsequently created those fixtures, and both compiled tests
passed on the identical runtime source. Initial failures are retained in the JSON summary and local logs.

## Isolation and evidence

Owned worktree: `tmar-scan-desktop-edit-integration-20261103`.
Local evidence root: `e2e-out/edit-integration/`; entry points `run-review.mjs`, `finish-review.mjs`
and `compiled-roundtrip.mjs`. Submitted tests were copied to that ignored directory with URL, output,
relative import path and owned browser-profile changes only; their assertions were not relaxed.
The compiled adapter replaces development hooks with public export/file UI and retains the independent
kernel checks. Test servers used automatically allocated loopback ports, never the author's `17531`,
and were closed after their scenarios. No live user CAD, QuickSurface, previous preview or personal tab
was opened or replaced. No frozen preview, installer or release was published.
The Italian localization worktree and `codex/edit-surface` were not modified by this review.

## Expanded mandate: acceptance still open

This ACK applies only to the two listed checkpoints on the stated main revision. Further QS command work
remains with the author and needs its own checkpoint/review; it is not preapproved by these results.
The existing limits remain: natural rectangular faces without arbitrary trims/holes, one face at a time,
Apply as a new body, and preservation of existing G1 rather than creation of missing tangency.
See the [plugin checkpoint](../../plugins/tmar-edit-surface/README.md).

The host regression scenarios establish coexistence in the main workspaces, not notes/Zebra overlays
inside the separate Edit Surface modal or automatic annotation reassociation after deformation.
Local editor Undo/Redo passed; dedicated host Undo/Redo after Apply with an existing annotated source body
remains an acceptance case. The control-net recipe is not persisted as an editable host feature.
Production STEP qualification, arbitrary trims, full QS coverage, native macOS and desktop packaging remain open.

Localization stays independent. Do not depend on unpublished language helpers. Once the shared contract
is published, the plugin owner should adopt it within the owned directory, keeping command names original
and translating help/tooltips. No translation coverage for the plugin is implied by this review.

[Machine-readable summary, including initial failures](edit-surface-integration-20261103.json).
