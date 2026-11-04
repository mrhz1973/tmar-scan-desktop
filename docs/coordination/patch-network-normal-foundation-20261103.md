<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Patch Network: normal-motion foundation and remaining integration gates

2026-11-03, Europe/Rome. Separate development from frozen host a28c747591e740d62f3b1f90330f145141c77de1. **This is a tested mathematical foundation, NOT an enabled UI feature, a CAD fit qualification or a numbered delivery.**

## What is actually delivered

`plugins/reverse/core/networkNormalMotion.ts` provides immutable, versioned on-scan anchors plus deliberate offsets in part-frame millimetres; signed numeric displacement; explicit tangential re-anchoring while retaining height; normal-line dragging from part-space rays (orthographic or perspective); CSS-pixel threshold, active-pointer ownership, view/frame revision rejection, explicit travel limit, and cancellation to the pre-gesture value. The caller chooses a measured surface normal or part Z. No implicit conversion of normal to world Z.

The module has no renderer, store, worker, kernel or Edit Surface dependency. It does not mutate a scan, fit, project, history or visibility. It is NOT registered or imported by a production entry point yet. `readCentreOffset` tests a proposed payload parser, NOT existing .scanruler support.

24 standalone Node tests PASS; strict TypeScript check of this module PASS. Environment: isolated Linux sandbox, Node 22.16.0. These are scalar/vector/state tests, not a browser/OCCT/app build or user-file test. Windows/source/build integration, actual CAD sewing and save/reopen have NOT run in this increment.

```sh
tsc --strict --noEmit --skipLibCheck --target ES2022 --module ESNext plugins/reverse/core/networkNormalMotion.ts
node --experimental-strip-types --test plugins/reverse/tests/networkNormalMotion.test.mjs
```

The .mjs tests intentionally run separately from the repository's Vitest `.test.ts` glob. The experimental Node type-strip warning is expected; no failed assertion was suppressed.

## Two separate scan constraints were found in the frozen sources

1. `plugins/reverse/viewer/networkLayer.ts`, pointerDown/step: all drag samples call `host.pickScan`; the centre then goes through `moveCell(..., 'centre', at, false)`.
2. `plugins/reverse/core/networkSplit.ts`, splitPolygons: `centresGiven[index]` is projected by `scan.closestInside`; derived centre/spoke geometry uses `onScan.point`.

Changing only the first path would show a misleading drag which the rebuild projects back onto the scan. Do not remove the second projection wholesale: the on-scan graph is also needed to find cells and construct their parameter maps. `network.ts` reads cells/maps before fitting; `networkFit.ts` couples neighbouring patches and reports continuity limits.

## Proposed next wiring, not implemented by this checkpoint

Scope the first UI delivery to the derived INTERNAL CENTRE of a split cell. Arbitrary network boundary nodes, CAD-constrained edges and all grip classes are not silently unlocked. A later increment can extend support once their topology and continuity constraints are tested.

- Keep existing on-scan centre/seed data and default tangential drag intact. Add an explicit optional centre-offset field, with version/units/frame validation in feature input, project loading, cloneData, reset and serialization. Legacy projects without it behave exactly as before.
- Toolbar/panel options: `Agganciato alla scansione`, `Normale`, `Z della parte`; numeric `Spostamento (mm)`. Commands retain their original names. The normal and origin are captured at gesture start. Near-head-on axes refuse unstable mouse motion with an explanation; numeric entry remains possible. Shift navigation and Ctrl selection keep their existing roles.
- Keep topology, scan cuts, patch membership, seeds and UV maps on the scan. Pass a SEPARATE deformation intent to the fitting stage, only after cell mapping. Shared centre/spoke targets must be assembled once and used by all adjacent patches. Recompute affected curve fits, then run the EXISTING coupled patch fit and sewing/continuity checks. Do not apply independent post-fit offsets to adjacent faces.
- Preserve outer boundaries and CAD-side constraints. Recalculate actual RMS/gaps/angles against the original, unchanged scan. An intentional lift is not scan noise to erase. Report the requested offset separately from fit error. Do not claim G1 at extraordinary vertices: the current fitter already documents limitations at three/five/six-patch centres.
- UI preview, report.centres, report.spokes and committed CAD must agree. Pending/stale/invalid fits cannot become committed results. Clamp nothing silently; refuse invalid or excessively requested motion using the explicit edit bound.
- One completed gesture = one local history step; samples are temporary. Esc, pointercancel, blur, lost capture, disposal or source replacement restore the pre-gesture value with no new history entry. A second pointer and a late mouseup must do nothing. Geometry/selection/mode changes invalidate late computations.
- Tangential movement of an already lifted centre must have an explicit rule: keep height and recompute the local normal, or choose a separate Reset-to-scan action. Merely hovering a scan must not erase the offset.

## Required integration tests before delivery

Use fresh synthetic scans/projects, not an active document. Compare unchanged tangent mode against baseline; centre +normal/-normal/part-Z and numeric values; tilted and transformed parts; oblique/head-on views; returning to the start; full Undo/Redo and redo pruning; Escape before mouseup, outside release and foreign pointer; scan immutability; independent report/mesh/STEP measurements; boundary/coupled-fit continuity diagnostics; rejected fold/self-intersection; persistence and rebuild after save/reopen; legacy projects; source and compiled browser; multiple split valences. Do not use 24 pure tests as evidence that these gates passed.

## Environment and ownership

The authorized Windows tunnel returned `mcp_initialization_required` before running a command. Remote Desktop Commander reported no online device. GitHub remained accessible. Consequently this increment did not inspect, overwrite or reuse the unpublished `networkOffsets.ts` in the existing Windows Patch Network worktree. Its content is unknown here and is deliberately preserved. Reconcile that helper later instead of overwriting it by filename.

All additions use new paths on a new GitHub branch. Frozen host branch, PR17 code, author plugin/worktrees, active projects, user sessions and Versione 1 are unchanged. No successful independent subagent review is claimed.
