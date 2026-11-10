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

The opt-in `TEST_NOTE_MOUSE=1` path of `e2e-workspace-compiled.mjs` also
passed on 2026-11-06 in a newly compiled isolated source-host snapshot using a
synthetic STEP box. It placed the note with a real mouse event while Zebra was
active, applied the copy, saved/reopened the project, observed the note without
an unresolved warning, and exported two valid, distinct solids. Evidence:
`%TEMP%/scanruler-compiled-click-note-qa/compiled-UrUiQ4/result.json`.

The saved archive recorded the attachment as `unresolved` when saved shortly
after Apply; the note appeared without an unresolved warning after reopening.
This transitional state must not be described as verified at save time. The
coordinator should investigate the save/revalidation timing on the exact host.
Earlier attempts `compiled-ZPQTCU` and `compiled-6dnAOM` failed on a too-strict
verified-at-save assertion; `compiled-gVfG9a` passed note reopen but failed an
export assertion because the original body was hidden. The final test explicitly
shows the original before checking the two-solid export. This is not a compiled
test on the user's LEGO, the exact coordinator host, or an installed app.
