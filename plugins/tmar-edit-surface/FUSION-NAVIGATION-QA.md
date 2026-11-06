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

The owner subsequently reported that rotation and panning both fail in the
running app. This report is not disproved by the Fusion-only test above. In
the source host, navigation bindings depend on the selected control scheme:
`cnckitchen` assigns left-drag to orbit and right-drag to pan, whereas `fusion`
assigns Shift+middle to orbit and middle to pan (`src/viewer/navSchemes.ts`).
In the plugin's automatic selection mode, a left press on a pole or segment can
be claimed for editing; an unselected cell press is left to host navigation.
These code paths are possible contributors, not a diagnosed cause of the
reported failure. Qualification must record the actual scheme and build and
exercise both gestures on and away from the control net, including release
and cancellation, before claiming the owner's issue fixed.

Navigation-only prototype: the workspace panel can temporarily release pointer presses over the control cage to the host, including when a cell is already selected. The mode also hides the free-edge drag handle. Unit tests verify routing back to the host layer and resumption of editing; this is not proof that the host camera or the owner's specific build and mouse scheme work. Actual application/desktop qualification remains required.
Follow-up review found and corrected three navigation-mode interactions: an in-progress deferred edge gesture is cancelled when navigation starts; the toggle remains in the panel while editing a free edge; and placing a note takes precedence over navigation-only click routing. Layer tests exercise gesture cancellation and note placement; the panel placement has not yet been exercised in a real browser or the packaged host.
A static React-render test now verifies that the navigation control remains visible and checked in the free-edge panel and that the session can switch back. This test does not drive a browser or validate the real camera.
