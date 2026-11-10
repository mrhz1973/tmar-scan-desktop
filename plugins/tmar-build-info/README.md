<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR numbered version and build identification

The top bar shows **Versione 1**, followed by 2, 3, and so on for subsequent coordinated deliveries. **Anteprima** remains explicit; a number alone never declares a stable release. Click the badge for Settings: source revision, build timestamp and dirty-tree status are under the initially collapsed **Dettagli tecnici** section.

The human number is validated from `tmar-version.json` at build time, separately from the actual Git provenance captured by `scripts/buildIdentity.mjs`. No repository lookup, commit count, date-based counter, localStorage counter or runtime network call determines the displayed number. Rebuilding and reloading leave it unchanged. Missing or malformed manifests stop the build rather than inventing a number. Without Git metadata the technical commit remains `unknown`, while a valid explicit delivery number is still available.

The inherited package version, project appVersion and original attribution remain unchanged. Old frozen previews retain their original identities; opening them does not upgrade them. This is not a desktop release or an automatic update mechanism.

[Numbering policy, next-delivery command and version history](../../docs/tmar-versions.md).

The plugin uses the existing `topbar.identity` and `settings.tools` slots. It has no dependency on Reverse engineer. Omitting the plugin leaves the original header available.

```sh
node --test scripts/test-tmar-version.mjs scripts/test-build-identity.mjs
node node_modules/vitest/vitest.mjs run plugins/tmar-build-info/tests
```
