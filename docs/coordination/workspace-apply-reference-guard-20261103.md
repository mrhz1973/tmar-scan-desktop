<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Workspace Apply: prevent old-source reference callbacks during publication

3 November 2026, Europe/Rome. Branch `fix/workspace-apply-guard-20261103`, direct parent `a28c747591e740d62f3b1f90330f145141c77de1`. Separate host correction, **not integrated into the frozen host branch, main or a user preview**. No changes to `plugins/tmar-edit-surface/**`, the public controller/view types, source guards, CAD kernel, transaction geometry, capabilities or numbering.

## Reproduction and confirmed cause

The reported `compiled-xl8yrV/failure.png` was inspected read-only. The coordinator then copied the author's current local plugin sources into a separate QA archive (86 files, SHA-256 manifest). This is an identified local source snapshot, not a claim that a published author commit includes it. The author copy, active QA server, STEP Lego and CAD sessions were not modified.

Against exact host a28c747, both source and compiled browsers reproduce the error using real UI input:

1. Import a generated 20 x 30 x 10 mm STEP box.
2. Open the real Edit Surface controller in the main view; select an editable planar face.
3. Select free poles, Local N, numeric displacement 0.05 mm; wait for validated Apply.
4. Click Apply: the editor remains open, only the original body remains, and status says `La sorgente CAD o il documento è cambiato: riapri la modifica.`

Debugger caught-exception stacks show:

```text
stageEditorCopy.publish
  -> historyAtomic
    -> useReverse.setState
      -> plugin view.subscribeReferences callback
        -> sync / refreshReferences
          -> view.references
            -> source.assertCurrent (old source)
              -> reportViewError / assertLive
                -> exception propagates into publication -> rollback
```

At the first source guard throw, recorded values are kernelChanged=true, buildChanged=true, featuresChanged=true and stepsChanged=true, but documentChanged=false, building=false, parametersChanged=false, elementsChanged=false and sectionsChanged=false. These are the host's OWN changes after successful validation and adoption, not an externally replaced document. The guard is correctly rejecting the old source; the old lease's reference notification should not run at that point.

This reproduces a concrete cause and matches the author's independently reported stack. It does not retroactively prove that every previous intermittent result had exactly this cause. The original host QA controller did not subscribe to references this way, so its earlier passing tests did not cover this interaction.

## Narrow host correction

`EditorReferenceNotifications` owns view-reference listeners. Live notifications retain synchronous behavior and are not silently swallowed. Its scoped suspension coalesces notifications; disposal discards them. `OwnedEditorViewport.suspendReferenceNotifications()` is HOST-INTERNAL and is not added to the public `EditorViewportLease` contract.

After asynchronous CAD staging and before entering synchronous publication, the manager suspends only the old lease's reference notifications. Exact source/session/stamp checks remain active and unchanged after all awaits and immediately before mutation.

- On success, closing the editor disposes the reference subscription and discards deferred old-source updates.
- On failure, atomic publication first restores the old source; the controller is unfrozen and returns to editing, then one deferred reference update is delivered. Retry remains possible.
- A real stale source immediately before publication still refuses Apply; cancellation before publication still prevents a late insert.
- The gate does not blanket-catch store observers, suppress real source invalidation, implement global cross-store atomicity, or make the old modal's queued generic import cancellable.

The author's separate change making view-error reporting non-throwing is complementary. No plugin code is changed by this commit. Combined acceptance against that future author checkpoint remains necessary.

## Verification

| Check | Result |
| --- | --- |
| Exact original host + local plugin snapshot, source browser | FAIL reproduced, stack and guard values recorded |
| Exact original host + same snapshot, compiled browser | FAIL reproduced, same callback chain |
| Corrected host + unchanged snapshot, source browser | 8 checks PASS |
| Corrected host + unchanged snapshot, compiled browser | 3 independent runs x 8 checks PASS |
| Whole-host TypeScript | PASS |
| Paired QA snapshot TypeScript and full production build | PASS; existing chunk/externalized-module warnings |
| Targeted host/unit/OCCT regressions | 83 PASS in 11 files (previous 74 + 9 new checks) |

Each successful real-controller browser run verifies Apply, toolbar project Undo/Redo, Save, reopening in a fresh page, STEP export and independent OCCT readback. Both solids are valid; original volume is 6000 mm³ and modified copy 5999.062475625071 mm³. Source and all three compiled runs record zero caught source-guard exceptions during publication and zero application console errors. This is a synthetic planar-face fixture, not Lego, arbitrary trimming, continuity or QS parity qualification.

New unit checks cover ordinary synchronous notifications, coalescing/nesting/disposal, independent subscription cleanup, not swallowing live errors, successful publication with a reference reader, rollback/refresh/retry, and true source replacement just before publication. Prior OCCT invalid STEP, source/document replacement, cancellation and injected publication-failure cases remain in the passing suite.

Local setup failures are retained: one interrupted tunnel write did not execute; an initial QA launch refused an already owned port; initial paired TypeScript lacked the updated HOST test mock until that test delta was copied. No application assertion was weakened to pass. A mistyped boundary-check script name was corrected before checking the actual script. No dependencies were installed and no global configuration was changed.

## Evidence and reproduction

Published evidence: `docs/coordination/evidence/workspace-apply-reference-guard-20261103/` contains baseline/fixed results, source stack, inspected screenshots, exact plugin-snapshot hashes and an evidence manifest. Full logs, generated STEP/project files, builds and isolated browser profiles stay under the coordinator's D: QA paths; profiles are not published.

`plugins/reverse/scripts/e2e-workspace-apply-guard.mjs` is the bounded UI regression. It requires a separately paired real workspace plugin (not included by this host-only commit), `SCANRULER_ISOLATED=1`, an owned evidence directory, and loopback QA port 17661 or 17662. It does not attach to an existing browser. Baseline and fixed scenarios use the same assertions.

Runtime files changed: `src/plugins/workspaceEditors.ts`, `src/viewer/editorViewportLease.ts`, new `src/plugins/editorReferenceNotifications.ts`. No public capability handshake change; still API 1 / `cad-copy` only. Apply with draft notes remains blocked. Note transaction, parametric history, Patch Network and layout/Settings work are separate. All owned QA servers were closed after tests; frozen a28c747 and Versione 1 remain unchanged.
