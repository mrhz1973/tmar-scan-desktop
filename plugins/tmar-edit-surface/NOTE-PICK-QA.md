# Zebra note placement on a real STEP

On 2026-11-06, the opt-in `TEST_NOTE_MOUSE=1` path of
`tests/e2e-workspace-integration.mjs` passed against the isolated source host
with its provisional fractional-ID fix and Edit Surface. On the owner's
`lego mod qs.stp` (SHA-256
`f47e9d2ff01ed35f392c762edd860fba5b6c90514de68d9cbc29951537931243`),
an automated mouse click on the selected visible CAD face placed a note while
Zebra was enabled. The note resolved after a further surface change, remained
attached to the applied CAD copy, and survived project save and reopen. The
exported solids validated and the original STEP hash was unchanged.

The successful report is `%TEMP%/scanruler-owner-click-note-qa/run-PkInnn/result.json`.
An earlier attempt (`run-OgU7lj`) failed before the note click because the test
used an unresolved browser module specifier; the test was corrected. Neither
run qualifies the exact host PR pair, the compiled app, or interactive user QA.
