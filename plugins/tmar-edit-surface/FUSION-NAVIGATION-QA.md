# Edit Surface: shared-view navigation QA

On 2026-11-06 the opt-in `TEST_FUSION_NAVIGATION=1` path of
`tests/e2e-workspace-integration.mjs` passed in an isolated source host with
its provisional fractional-body-ID fix and this plugin. The input was the
owner's `lego mod qs.stp` (SHA-256
`f47e9d2ff01ed35f392c762edd860fba5b6c90514de68d9cbc29951537931243`).

With a supported imported CAD face and its control net active, real mouse
events changed the shared camera as expected for the Fusion scheme:
Shift+middle rotated, middle panned and the wheel zoomed. Afterwards a control
point was dragged, the resulting CAD was applied and the output reimported as
a valid solid. The original file hash was unchanged. The local report was
`%TEMP%/scanruler-owner-navigation-qa/run-bwpVWA/result.json`.

This does not establish the control scheme selected by the owner, the behavior
of the owner's running build, the exact host PR integration, packaged-app
qualification, or camera behavior for other navigation schemes. The temporary
QA host is not the authoritative host branch. The host coordinator must verify
the fix against the exact host/plugin pair before delivery.
