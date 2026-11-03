// SPDX-License-Identifier: AGPL-3.0-only
import { BUILD_IDENTITY } from '../../src/buildIdentity'
import { TMAR_VERSION, tmarVersionLabel, tmarChannelLabel } from '../../src/tmarVersion'
import { APP_VERSION } from '../../src/version'
import { usePrefs } from '../../src/state/prefsStore'
import './buildInfo.css'
export function BuildBadge() {
  const label = tmarVersionLabel(TMAR_VERSION), channel = tmarChannelLabel(TMAR_VERSION)
  return <button type="button" className="tmar-build-badge" data-test="tmar-build-version"
    data-version={TMAR_VERSION.number ?? 'unassigned'} data-channel={TMAR_VERSION.channel}
    data-revision={BUILD_IDENTITY.revision} data-dirty={String(BUILD_IDENTITY.dirty)}
    aria-label={`TMAR ${label}, ${channel}. Apri informazioni sulla versione`}
    title={`TMAR · ${label} · ${channel}${BUILD_IDENTITY.dirty ? ' · copia modificata' : ''}\nApri Settings per informazioni e dettagli tecnici.`}
    onClick={() => usePrefs.getState().openSettings(true)}>
    <span className="tmar-build-brand">TMAR web · {channel}{BUILD_IDENTITY.dirty ? ' · modificata' : ''}</span>
    <strong data-test="tmar-human-version">{label}</strong>
  </button>
}
export function BuildSettings() {
  return <section data-test="tmar-build-details" aria-label="Informazioni sulla versione TMAR">
    <h3>TMAR · {tmarVersionLabel(TMAR_VERSION)}</h3>
    <p>{tmarChannelLabel(TMAR_VERSION)} · Base ScanRuler {APP_VERSION}</p>
    <p className="hint">Le versioni TMAR seguono l'ordine 1, 2, 3… Questa è la versione caricata: una vecchia anteprima non si aggiorna da sola.</p>
    <details data-test="tmar-technical-details"><summary>Dettagli tecnici</summary>
      <label className="setting">Commit sorgente <input aria-label="TMAR source revision" value={BUILD_IDENTITY.revision} readOnly /></label>
      <p>Built: <time>{BUILD_IDENTITY.builtAt}</time></p>
      <p className="hint">{BUILD_IDENTITY.revision === 'unknown' ? 'Commit non disponibile: compilazione senza metadati Git.' : BUILD_IDENTITY.dirty ? 'Compilata da una copia di lavoro modificata rispetto al commit indicato.' : 'Compilata dal commit indicato, senza modifiche locali.'}</p>
    </details>
  </section>
}
