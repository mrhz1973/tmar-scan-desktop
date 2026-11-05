# Direct D handle on imported multi-face sheets

The workspace can start a free-edge extension on a validated imported open sheet containing multiple faces. It retains the initial face count and checks each extension adds exactly one face. Solids, G1-constrained drafts, cylinder mode, notes and concurrent gestures remain excluded. Shared seams are not offered as free edges.

The controller/worker/OCCT test covers a synthetic sheet from 2 to 3 faces, reopening and another extension from 3 to 4, Undo/Redo, stale requests and refusal without losing the last valid preview. An isolated browser test using simulated pointer input and real OCCT passed both D gestures, source preservation, STEP validity, save/reopen and rejection of clicks on shared seams. Evidence: `scanruler-edit-surface-qa/workspace-multiface-d-YR9zVz/result.json`, outside the repository.

These tests do not establish physical-input or compiled-desktop behavior, arbitrary topology coverage, or parity with QuickSurface. The second saved project was not reopened again. Integration with the coordinator's host remains pending.
