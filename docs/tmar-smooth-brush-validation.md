<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Regional Smooth, retained Brush and held-Shift navigation

Verified November 2, 2026. Base `1b7232d37e92481aa569930a6cec376ed1efc76b`.
Tested clean source `fb49780cf305eac189bd1bb5a42a49ae475c1e1a`. User acceptance and real-project reproduction remain **OPEN**.

## Report versus reproduced behavior

The user reported that regional Smooth affected the whole object, that the
button needed another brush stroke after application, and requested holding
Shift for normal left/right navigation while Brush, Window or Lasso is selected.

A baseline run with a genuine mouse Brush stroke on an isolated noisy sheet
selected 52 vertices. Two applications retained those IDs and the button was
enabled; the first moved 52 selected vertices and zero unselected vertices.
The reported global movement/button-disable failure was therefore **not
reproduced on that baseline fixture**, and is not presented as a conclusively
diagnosed failure of the user's specific project. What was reproduced was
Smooth resetting the chosen Brush to Navigate. No live user project was loaded
or smoothed to investigate this report.

## Changes

The UI now snapshots its exact painted region and scope when Smooth is pressed.
A marked request cannot become a null/whole-part request; empty and obsolete
regions fail without editing. Explicit whole-part smoothing remains available,
but its action says **Smooth whole part**, while a regional status line says
**Marked region only** and reports the selected vertex count. Clicking a scope
selector does not run smoothing or undo a previous edit.

Successful Smooth restores both the exact vertex-mapped selection and the
selected marking tool/erase/backface settings. No fresh brush dab is needed to
apply again. Clear remains explicit. The intensity blend avoids touching any
unselected coordinate, including its signed-zero representation; that small
representation issue was caught by a strict unit test and does not explain the
reported whole-piece visual change. The original scan in use is still untouched
until Use for analysis. Repeated edits and their per-application limits remain
cumulative. Existing history and project data are retained.

Holding Shift shows Navigate temporarily and uses the current control scheme's
normal left/right bindings. Releasing Shift returns to the same marking tool
without changing the mask. Modifier changes are recognized during a held drag,
and a Shift arriving during a brush stroke stops marking before the camera moves.
An unfinished window/lasso preview is cancelled rather than applied under a moved
camera. Text fields/dialogs are excluded from the keyboard feedback; loss of focus
clears temporary feedback. A fresh marking press is required after switching to
navigation during a held stroke, avoiding an accidental paint trail.

## Actual local verification

Windows/Chrome, owned worktree and isolated browser profiles only.
**257 unit tests** passed, including all inherited Smooth tests, explicit
regional guards, strict outside-region coordinates, navigation bindings across
all 14 built-in schemes, live modifier transitions, and SpaceMouse regressions.
Independent category and build identity checks, TypeScript, production build,
plugin boundaries, unit-label policy and Zebra reflection checks also passed.

**580 browser assertions** passed, with all final exits zero and no
application console errors. Local results do not imply hosted GitHub CI or full
upstream qualification. Two note/MCP scenarios initially stopped before testing
because the isolated worktree lacked MCP test dependencies. Those same locked
dependencies were copied locally, without changing package versions or security
settings, and both scenarios were rerun on the identical clean commit. Original
failed-start logs and the before-retry result record are retained separately.

| Browser scenario | Result |
| --- | --- |
| brush-shift | 65 checks, exit 0 |
| mesh-review | 22 checks, exit 0 |
| repeat-smooth | 19 checks, exit 0 |
| mesh-edits-original | 76 checks, exit 0 |
| step-scan | 22 checks, exit 0 |
| cad-edges | 25 checks, exit 0 |
| categories | 35 checks, exit 0 |
| zebra | 32 checks, exit 0 |
| usability | 40 checks, exit 0 |
| tmar-web | 15 checks, exit 0 |
| reverse-notes | 54 checks, exit 0 |
| note-provenance | 22 checks, exit 0 |
| brush-shift-production | 49 checks, exit 0 |
| mesh-review-production | 18 checks, exit 0 |
| step-scan-production | 15 checks, exit 0 |
| cad-edges-production | 9 checks, exit 0 |
| category-production | 22 checks, exit 0 |
| focus-production | 31 checks, exit 0 |
| production | 9 checks, exit 0 |

The new test uses real Brush, Window and Lasso pointer gestures (not mesh.mark),
clicks Smooth twice without navigating away or repainting, checks retained
selection/gesture, and compares actual model pixels during both Shift drags.
The development run additionally compares exact selected IDs and outside-region
positions, and repeats the geometry checks on a closed noisy STL box including
its unselected side/back surfaces. The compiled run uses public UI only and no
application development globals. Previous note/Zebra/STEP/export/category and
project round-trip regression scenarios are retained, not replaced.

## Boundaries and reproduction

The user's specific mesh and live browser state were not inspected. New guards
and passing synthetic cases are not a claim that every real-file cause is known.
macOS/Safari, huge scans, mesh topology changes, persistent named selections and
split-view qualification remain outside this increment. Nothing was done to
QuickSurface, the user's open documents or existing frozen preview servers.
No dependency, license, kernel or saved-project-format change was made.

```sh
npx vitest run tests/markShiftNavigation.test.ts plugins/tmar-smooth-controls/tests
npm run build
node plugins/tmar-smooth-controls/scripts/e2e-brush-shift.mjs
# For the compiled path, set PRODUCTION=1 and run the same script.
```

Keep the displayed TMAR source revision with any follow-up report; frozen old
previews do not acquire these changes by refreshing another port.
