<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Apply CAD-copy: source visibility and overlap diagnosis

3 November 2026, Europe/Rome. Host-only increment on branch
`feat/apply-source-visibility-20261103`, parent
`64af91e87f076e58af2094683ee233d34832ee23` (PR #20).
The frozen host branch stays at `a28c747591e740d62f3b1f90330f145141c77de1`.
No plugin edit, merge, numbered preview, main update or desktop release.

## Author checkpoint and isolated pairing

The published plugin checkpoint `b36bf5a195db8c711347ff34117fa40d3bc279c9`
was fetched and its `WORKSPACE-INTEGRATION.md` read. It changes only the
plugin. Its exact committed subtree was paired with this host in a separate
D: QA archive, not cherry-picked into this host branch or any author worktree.
The published hashes identify the plugin files used in these runs.
Reported author results on Lego, box, notes, snap and strips remain separate
from the coordinator checks listed below. No general QS parity is inferred.

## Red hatching: controlled diagnosis

The supplied `existing-nurbs-LK23A9/failure.png` and its result were inspected
read-only. The picture alone did not establish a rendering cause. We then
reproduced the red hatching on a separate committed synthetic STEP containing
an already-existing rational B-spline face:
`plugins/tmar-edit-surface/evidence/refined-roundtrip/run-Zlk2YR/edited.step`.
Its SHA-256 is `baf41153abbcb6b4b9343f3daa9aca2dd22af945d89da1e87d860c5844950747`.
This is NOT the exact LK23A9 input or the owner's Lego file.

After a real UI deformation and Apply, both bodies were visible. Source-app
instrumentation identified the visible overlay created by
`ReScene.setOverlaps`: color `0xe0564f`, `hatch(material)`, and a no-op raycast.
The CAD kernel supplied the actual overlap between original and copy.
Switching only `overlapsShown` off removed that overlay while both bodies,
volumes and camera pose stayed unchanged; switching it back on restored it.
Hiding only the original also removed it while Overlaps remained enabled.
Screenshots were inspected. This identifies the reproduced red pattern as
interference hatching, not Zebra or evidence of invalid CAD. Coincident
surfaces can still have ordinary depth competition when both are shown;
turning off the interference overlay is not a geometry fix.

## Implemented user behavior

The host dock now has **Nascondi l’originale dopo Applica**. It is checked by
default on each new workspace-editor session and can be unchecked to retain
both bodies visible. The choice is frozen before asynchronous preparation
and cannot change during Apply. It is host presentation state, not a field in
the plugin's geometry ticket and not a new annotated capability.

On successful Apply the source body remains geometrically present but its ID
is added to `hiddenBodies` in the SAME synchronous publication that adds the
copy. The copy is visible; unrelated body visibility and the Overlaps switch
are unchanged. The original remains accessible through its ordinary eye in
the Bodies tree. Apply failure or Cancel does not hide it.

Undo removes the new copy and restores the source visibility as it was just
before publication. Redo reapplies that operation's policy. This is an
operation-owned visibility delta, not an entire hidden-bodies snapshot, so
later visibility changes to unrelated bodies survive. An already hidden
source stays hidden on Undo. Chained copies restore the respective source
at each step. Global body-group visibility is not forced on.

Existing project `hiddenBodies` serialization is reused. Its changes now
participate in the project's dirty watcher. The policy checkbox itself resets
on a new editor session; it is not yet a global Settings preference. Saving
preserves the resulting CAD bodies and their visibility, not local pole
history or Undo entries across application restart.

## Actual host contract

The public plugin `WorkspaceEditorController`, `EditorViewportLease`,
`ApplyTicket`, `PreparedCadCopy`, units/frame and capability handshake are
UNCHANGED: API 1, `cad-copy` only; notes still block bare-copy Apply.

Internal host changes:

- `WorkspaceEditorState.hideSourceAfterApply` and
  `workspaceEditors.setHideSourceAfterApply(boolean)` are consumed by the dock.
- The host adapter receives an optional fourth `EditorApplyDisplayOptions`
  argument during staging. The Reverse adapter binds the source ID itself.
- `stageEditorCopy` accepts an optional host-only `{hideSourceBodyId}` fifth
  argument. Omission preserves the older keep-both behavior.
- `historyAtomic` accepts an optional synchronous `HistoryRestoreEffect` for
  its own entry. Only source visibility is changed by this effect; no CAD,
  notes, camera or borrowed geometry is mutated by it.

The reference-notification fix from PR #20 remains in place. Final source,
document and preview guards, CAD staging, rollback, idempotency and cancellation
were not weakened. The separate annotation-runtime worktree will need an
explicit reconciliation of its history/manager changes; it was not modified.

## Verification

| Check | Result |
| --- | --- |
| Host TypeScript | PASS |
| Paired host + exact b36bf5a TypeScript | PASS |
| Paired complete production build | PASS, existing bundle/module warnings |
| Host/unit/real-OCCT regressions | 93 PASS / 11 files; ten new tests |
| Published plugin session/layer units on paired host | 48 PASS / 2 files |
| Source diagnosis of red overlay | 8 checks PASS |
| Real-plugin source flow, hide-original ON and OFF | 2 runs x 10 checks PASS |
| Real-plugin compiled UI, hide-original ON and OFF | 2 runs x 10 checks PASS |
| Legacy source-host probe, explicitly keeping both | 14 checks PASS |
| Plugin boundary checker | One pre-existing gallery import failure |

The real-plugin source and compiled flows select an existing B-spline,
modify it numerically along N, Apply, Undo/Redo, Save, reopen a fresh page,
verify individual eyes, and export STEP for independent OCCT reimport.
The original volume is 6192.107966783208 mm3, the modified copy
6194.055651269608 mm3. Both bodies remain in the reopened project. Before
exporting both, the test explicitly shows the original again; this happens
AFTER checking persisted hidden visibility. The input STEP hash is unchanged.
All four real-plugin workflows have zero application console errors.

New kernel checks include unrelated visibility, initially hidden source,
publication rollback, cancelled staging, invalid source ID, chained copies,
ordinary open sheet, and project-section roundtrip. Manager checks cover
choice freeze, explicit keep-both and Cancel. An initial new test incorrectly
required exact floating equality for sheet area (599.9999999999999 versus
600 mm2); it was corrected to a documented 9-decimal comparison. No runtime
geometry code was changed for that test. The initial failed log is retained.
The legacy host probe's preservation assertions are unchanged; it now chooses
keep-both explicitly rather than relying on the previous default.

## Scope and remaining gates

This qualifies the visibility option with the specified plugin/host pairing,
not every plugin operation. The owner's real Lego, all topology families,
large-model performance, persistent annotated Apply, parametric history,
Patch Network normal integration, layout A/B/C, Settings/tooltips and desktop
packaging remain separate. No live CAD document or author server was used.
No independent-agent endorsement is claimed.

Published results, inspected screenshots and hash manifest are under
`docs/coordination/evidence/workspace-apply-source-visibility-20261103/`.
Full profiles/logs/projects/STEP exports remain in the isolated D: QA output.
The opt-in regression is `plugins/reverse/scripts/e2e-apply-source-visibility.mjs`;
it requires the separately paired plugin, loopback port 17671/17672,
`SCANRULER_ISOLATED=1` and an owned absolute output directory.
Versione 1 and all existing user previews remain unchanged.
