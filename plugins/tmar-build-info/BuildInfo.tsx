// SPDX-License-Identifier: AGPL-3.0-only
import { BUILD_IDENTITY, shortBuildRevision } from '../../src/buildIdentity'
import { APP_VERSION } from '../../src/version'
import { usePrefs } from '../../src/state/prefsStore'
import './buildInfo.css'
export function BuildBadge() {
  const short = shortBuildRevision(BUILD_IDENTITY)
  return <button className="tmar-build-badge" data-test="tmar-build-version"
    data-revision={BUILD_IDENTITY.revision} data-dirty={String(BUILD_IDENTITY.dirty)}
    title={`TMAR web build: ${BUILD_IDENTITY.revision}${BUILD_IDENTITY.dirty ? ' (modified working tree)' : ''}\nBuilt: ${BUILD_IDENTITY.builtAt}\nScanRuler base: ${APP_VERSION}\nClick for Settings and full build details.`}
    onClick={() => usePrefs.getState().openSettings(true)}>
    <strong>TMAR web</strong><code>{short}{BUILD_IDENTITY.dirty ? ' +modified' : ''}</code>
  </button>
}
export function BuildSettings() {
  return <section data-test="tmar-build-details" aria-label="TMAR build information">
    <h3>TMAR build</h3>
    <p>Web preview · ScanRuler base {APP_VERSION}</p>
    <label className="setting">Source revision <input aria-label="TMAR source revision" value={BUILD_IDENTITY.revision} readOnly /></label>
    <p>Built: <time>{BUILD_IDENTITY.builtAt}</time></p>
    <p className="hint">{BUILD_IDENTITY.revision === 'unknown' ? 'Source revision unavailable: this build was made without Git metadata.' : BUILD_IDENTITY.dirty ? 'Built from a modified working tree, not exactly the recorded commit.' : 'Built from the recorded clean source revision.'} This identifies this loaded application; opening an old preview does not update it.</p>
  </section>
}
