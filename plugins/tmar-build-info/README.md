<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR build identification

The top bar shows **TMAR web** and the seven-character source commit beside
ScanRuler's branding. Click the badge for Settings: full source revision, UTC
build timestamp and whether the source tree was modified. This is the identity
of the loaded bundle, not a query of the latest GitHub version. Frozen previews
keep their original identity even if main advances.

`+modified` explicitly means the bundle is not exactly its recorded commit.
A source archive without Git metadata says `unknown`, never an invented version.
The inherited package version, project appVersion and original attribution are
unchanged. This is not a new desktop release or an automatic update mechanism.

The plugin registers the generic `topbar.identity` and `settings.tools` slots.
The build-time helper is `scripts/buildIdentity.mjs`; host data is exposed through
`src/buildIdentity.ts`. No dependency on Reverse engineer and no network calls.
The optional plugin can be omitted without breaking the original header.

```sh
node --test scripts/test-build-identity.mjs
npx vitest run plugins/tmar-build-info/tests
```

[Integration validation](../../docs/tmar-step-scan-validation.md).
