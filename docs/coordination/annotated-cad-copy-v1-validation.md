<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Annotated CAD-copy v1 — qualification record

3 November 2026, Europe/Rome. Host branch `feat/annotated-cad-copy-v1-host-20261103`,
parent `27c75c3364511dd77e2ec0c5b8f314f529df6291`. This increment keeps the PR #20
reference-notification guard and PR #21 source visibility policy. The author
plugin is not changed or cherry-picked into this branch.

## Pinned pairing before annotated-host changes

Host `27c75c3364511dd77e2ec0c5b8f314f529df6291` was paired in a separate QA archive
with the exact published plugin `8a02e89aac7a99c13fbe4fd0153d50d1d80e4959`.
Only test-harness ports and metadata were adapted; production plugin files were
not edited. The moving author branch is not a replacement for this pinned SHA.

| Check | Result |
| --- | --- |
| Paired whole-application TypeScript | PASS |
| Plugin workspace session/layer unit suites | 56 PASS (28 + 28) |
| Paired full production build | PASS, inherited bundle warnings |
| Actual D handle, source UI, synthetic sheet/X | 10 checks PASS |
| Compiled ordinary Apply/hide-source/Undo/Redo/save/reopen/STEP | 10 checks PASS |

The D test verifies real mouse preview, Escape, release, local Undo/Redo, exported
two-face shell and one sewn seam. The compiled ordinary-copy test edits the
pre-existing B-spline fixture, preserves source hiding after reload and reads
both solids independently (6192.107966783208 / 6194.055651269608 mm³). This does
NOT qualify D in the compiled UI, Y/Z pointer interactions or general QS parity.
The author's sampled G1 result remains author evidence; it was not rerun here.

## Annotated runtime checks

| Check | Result |
| --- | --- |
| Host TypeScript | PASS |
| Updated annotated host + pinned plugin TypeScript/build | PASS |
| Targeted host/history/project/OCCT suites | 122 PASS in 13 files |
| Real annotated CAD kernel tests, included above | 16 PASS |
| Annotated manager negotiation/stale-note/cancel cases, included above | 6 added cases PASS |
| Source-app annotated lifecycle + actual native Save/Load | 13 checks PASS |
| Normal compiled-app annotated Load/Save and STEP readback | 7 checks PASS |
| Unmodified author plugin note/Zebra/Cancel on updated host | 6 checks PASS |
| Plugin boundary check | One pre-existing gallery-import FAIL |

### What the source-app proof actually exercises

`tests/fixtures/annotatedEditorProbe.tsx` is explicitly a QA controller, not the
author's annotated adapter. It registers only when the test imports it in the
source browser; it is not imported/registered by the production app. It supplies
an OCCT-generated original box, edited box and final-face BREP witness to the
REAL host service. Text is entered with actual keyboard input in the QA panel;
Apply, Undo, Redo and Save are actual host UI actions.

Before Apply the note remains local. On Apply, the real worker verifies the
witness/anchor, the host creates one copied body and one owned note in one history
action, and the original is hidden according to the checkbox. An unrelated note's
text is then changed; Undo removes only the copy and owned note, Redo restores
both without overwriting that unrelated edit. All participating observer error
queues remain empty.

The actual downloaded `.scanruler` archive is opened in a fresh page. Text,
note UUID, feature UUID, source/destination UV, position and oriented normal are
preserved. The host revalidates the attachment against rebuilt CAD; `noteOut`
resolves it without a nearest-face fallback. Independent OCCT reads the reopened
copy as a valid 7200 mm³ solid. Original visibility remains hidden. Source browser
application console errors: zero.

### Compiled app, with no injected controller

The same saved native project is loaded through the file picker in the ordinary
production bundle. The note and pin are visible, no unresolved-anchor warning
remains after CAD validation, and the source/copy visibility is preserved. A
second native Save retains the same UUID, text, verified attachment, position and
normal. Both bodies are shown ONLY after checking persisted visibility, for STEP
export. Independent OCCT reads valid solids of 6000 and 7200 mm³. The input project
file remains byte-for-byte unchanged and console errors are zero.

This qualifies reading/resaving the annotated result in the compiled app, NOT
annotated Apply from a compiled full Edit Surface adapter. That adapter remains
author work. The unchanged plugin was additionally exercised with a clicked note
and Zebra: Apply stays blocked because optional annotated methods are absent;
Cancel preserves CAD/render geometry, body list, build and history. Re-exported
STEP bytes may differ in serialization metadata; that test compares CAD geometry
rather than claiming equal re-export byte hashes.

### Safety and persistence cases

The real-kernel suite includes complete-state observer publication, injected
publication failure, reentrant note-mutation rejection, stale document after
staging, Cancel, wrong witness/normal, duplicate/malformed bundles, stale note
revision, note-content hashing, unrelated-note edits, latest owned text, explicit
note deletion, refusal of unsafe Undo dependencies, hidden source with selective
Undo/Redo, missing STEP resources, native member restoration and revalidation of
witness parameters separately from destination parameters. Legacy CAD-copy and
source-change/rollback tests remain in the targeted passing set.

A missing or changed artifact keeps note text but marks the target unresolved.
No generic parametric face remapping, all-topology identity proof or cross-session
retry guarantee follows from these tests. Correspondence uses conservative finite
CAD sampling and classification with documented tolerances.

## Retained failures and corrections

The recovered unpublished annotation work was backed up before reconciliation.
The frozen host and the original annotation/Patch Network WIP worktrees were not
changed. Conflict resolution retained both the notification barrier and the
operation-specific source-visibility restoration; notes add a separate history
delta instead of replacing the visibility effect.

An initial roundtrip test incorrectly saved only model JSON without its STEP
archive member. The verification correctly kept the note unresolved. The test
setup was corrected to provide native members; the verified-identity assertion
was retained, and a separate negative missing-member test was added. A later
TypeScript check rejected two untyped parameters in a new test mock; explicit
string types corrected the test. These initial logs remain in local QA output.

The first remote invocation was blocked by tunnel initialization; after a config
read the tunnel became usable. No global config, installed dependencies or
security settings were changed. No successful independent subagent review is
claimed for this increment. Local testing used the existing dependency junction,
separate D: caches/profiles and only owned loopback servers.

## Evidence

Published bounded evidence lives under
`docs/coordination/evidence/annotated-cad-copy-v1-20261103/`: result JSON, inspected
screenshots, generated synthetic native project, compiled resave, type/build/unit
summaries and hashes. Full logs/builds/profiles remain in the ignored owned
`e2e-out/notes-v1/` directories; original STEP exports are not whitespace-cleaned.

Reproduction scripts:

```text
plugins/reverse/scripts/e2e-annotated-host.mjs
plugins/reverse/scripts/e2e-annotated-reopen-compiled.mjs
```

They require explicit isolated origins, owned absolute output paths and a newly
launched browser. They do not attach to active user sessions. The native file
contains synthetic geometry and QA note text only. No owner Lego or other user
project was read/copied for these tests.

Remaining: actual author annotated controller/worker handoff integration, its
source and compiled full-workflow tests, broader/real geometry/topology cases,
notes on scan/edges/vertices or multiple faces, parametric recipes, large projects,
older-build roundtrips, desktop/macOS, Patch Network integration, layouts/timeline,
Settings/tooltips. No release, main merge or replacement of Versione 1 is implied.
