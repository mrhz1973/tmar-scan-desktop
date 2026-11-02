<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Dark default and README gallery validation

Verified **November 3, 2026 (Europe/Rome)** on Windows/Chrome.
Base: `563b429c4e38b8550d2c1ffa1d9fca6d86a232d0`.
Tested clean runtime: `08150a0ba2eecb914a91095192ec29e31c55ea64`.
**User visual acceptance and outstanding real-project review remain OPEN.**

## Appearance behavior

Dark is used when there is no saved theme, the saved value is invalid, or browser
storage cannot be read. The initial HTML shell and the hydrated preference store
use the same rule. A light OS does not switch the default interface to light.
Explicit saved Light, Dark and System choices still win. System follows OS
changes only when explicitly selected. Manual choices persist through reload
when browser storage is available. No preference migration overwrites a user's
explicit choice. Settings explains this behavior.

This changes only the interface's default theme. It does not change the default
Scanner blue material, mesh geometry, Smooth implementation, CAD kernel, note
records, project schema, dependencies or licensing. Existing previews remain
frozen; they do not update when the repository changes.

## Checks actually run

- **51 targeted unit tests across four files passed**, including 20 new checks
  covering first-paint HTML, preference-store initialization, light/dark OS,
  explicit choices, empty/invalid values, blocked storage, absent matchMedia and
  live System changes. Existing colormap, support-card and view-command tests
  were retained.
- Whole-app TypeScript and production build passed. The existing large-chunk
  build warning is not suppressed or represented as an application error.
- **31 compiled-browser checks passed**, on isolated browser contexts, with OS
  light/dark preferences emulated. Initial appearance, Settings, persisted Light
  and Dark, live explicit System changes and blocked storage were checked.
  No application console/page errors. No agent connection was enabled.
- **49 compiled Brush/Window/Lasso/Smooth/Shift checks passed** on synthetic
  geometry using real pointer gestures. No application console errors. These
  are UI regression checks, not a reproduction of the user's unresolved
  whole-object Smooth report on a real project.
- Plugin boundaries and display-unit policy passed.

This is a targeted verification, not a claim that the entire upstream suite,
macOS/Safari, a desktop installer or GitHub-hosted CI passed. OS media emulation
in Chrome is not native macOS qualification.

Reproduce the new browser checks with `node scripts/e2e-tmar-dark-default.mjs`
after `npm run build`. The script starts its own preview unless APP_URL is given;
only use an isolated test URL. The compiled regression is
`PRODUCTION=1 node plugins/tmar-smooth-controls/scripts/e2e-brush-shift.mjs`
(use the environment-variable syntax appropriate for the shell).

## Published screenshots

The README begins with the exact previously authorized original Zebra screenshot
and its review-in-progress notice. Its SHA-256 is unchanged:
`44454b883ec76e53fdbea99b5bfe911fd3258df1774a708566661ae3407f70f9`.

The thumbnail overview contains **12 clickable items**: that original plus
**11 new actual UI captures** on generated synthetic geometry. Full captures are
1720 x 1080; thumbnails are proportional 480-pixel-wide PNG downscales. They were
visually reviewed before publication. No cropping, retouching, fabricated controls,
private model or user session was used. Notes and geometry are synthetic.
The agent token is empty and the connection is off in the Settings example.

The source revision is visible in the screenshots and recorded with hashes in
[the image manifest](images/ui/manifest.json). Capture setup uses development
commands to create demo geometry; the separate compiled theme/gesture tests use
public UI. Some screenshots use the existing Studio grey shading setting for
legibility; this does not change the application's default material.

[Gallery and individual captions](tmar-ui-gallery.md) ·
[Image provenance](images/README.md) · [Open backlog](tmar-review-backlog.md).

No existing user tab, QuickSurface window, source model or frozen preview was
reloaded or replaced. No release or installer was published.
