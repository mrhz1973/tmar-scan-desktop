# Local-direction stretch

Stretch now uses the selected direction: world X/Y/Z in axis or screen mode,
or the U/V/N frame at the first editable selected pole in local mode. The
scaling centre is the projection of the entire net's centroid onto that
direction; protected poles remain protected. A missing or degenerate local
frame is rejected. The UI labels the chosen direction and explains the centre.

The session suite passed 56 tests, including a rotated plane whose local U is
world Y and Undo/Redo. TypeScript passed. A source UI run on the owner's LEGO
STEP passed the local-U button, expected movement and Undo, followed by valid
CAD-copy export. The STEP hash remained unchanged. Evidence:
`%TEMP%/scanruler-local-stretch-lego-qa/run-VLXl7V/result.json`.
The preceding `run-nBSp4p` could not find an off-centre unlocked pole in the
default G1 mode; the successful test explicitly selected G0. This does not
qualify arbitrary curved faces, the coordinator's exact host, the compiled
application, or parity with QuickSurface.
