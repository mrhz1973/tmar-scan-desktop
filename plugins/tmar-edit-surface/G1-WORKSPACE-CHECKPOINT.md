# G1 workspace checkpoint

The workspace exposes explicit selection of a shared natural straight edge and its adjacent planar support. Applying the constraint updates the CAD draft and permits local Undo/Redo. It is not a certificate of global G1 continuity, and does not cover arbitrary trimmed or curved supports. The constraint is held in draft history; persistent parametric replay is not implemented.

Verification on this change: TypeScript passed; 92 existing workspace tests and six targeted session tests passed. The session tests use a controlled worker. On the isolated annotation-capable host, simulated UI input with the real OCCT worker passed on a synthetic sewn two-face shell: create a tangency defect, constrain it, undo/redo, enable Zebra and place a note, apply a CAD copy, verify source and output, save and reopen with the note verified. Evidence: `scanruler-edit-surface-qa/workspace-g1-plane-SMX9HM/result.json`, outside the repository.

The first UI run checked a stale snapshot before asynchronous note verification completed. The corrected test waits for the actual verified state; no acceptance condition was relaxed. This is not a real solid STEP test, physical-input test, desktop release qualification, or proof of QuickSurface parity. Integration with the coordinator's host branch remains pending.
