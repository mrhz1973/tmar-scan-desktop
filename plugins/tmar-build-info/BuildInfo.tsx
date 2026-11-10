// SPDX-License-Identifier: AGPL-3.0-only
import { BUILD_IDENTITY } from '../../src/buildIdentity'
import { TMAR_VERSION, tmarVersionLabel, tmarChannelLabel } from '../../src/tmarVersion'
import { APP_VERSION } from '../../src/version'
import { usePrefs } from '../../src/state/prefsStore'
import './buildInfo.css'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'

export function BuildBadge() {
  useTmarLanguage()

  const label = tmarVersionLabel(TMAR_VERSION), channel = tmarChannelLabel(TMAR_VERSION)
  return <button type="button" className="tmar-build-badge" data-test="tmar-build-version"
    data-version={TMAR_VERSION.number ?? 'unassigned'} data-channel={TMAR_VERSION.channel}
    data-revision={BUILD_IDENTITY.revision} data-dirty={String(BUILD_IDENTITY.dirty)}
    aria-label={tmarText("TMAR {0}, {1}. Apri informazioni sulla versione", [tmarText(label), channel])}
    title={tmarText("TMAR · {0} · {1}{2}\nApri Settings per informazioni e dettagli tecnici.", [tmarText(label), channel, BUILD_IDENTITY.dirty ? tmarText(" · copia modificata") : ''])}
    onClick={() => usePrefs.getState().openSettings(true)}>
    <span className="tmar-build-brand">{tmarText("TMAR web · ")}{channel}{BUILD_IDENTITY.dirty ? tmarText(" · modificata") : ''}</span>
    <strong data-test="tmar-human-version">{tmarText(label)}</strong>
  </button>
}
export function BuildSettings() {
  useTmarLanguage()

  return <section data-test="tmar-build-details" aria-label={tmarText("Informazioni sulla versione TMAR")}>
    <h3>{tmarText("TMAR · ")}{tmarVersionLabel(TMAR_VERSION)}</h3>
    <p>{tmarChannelLabel(TMAR_VERSION)}{tmarText(" · Base ScanRuler ")}{APP_VERSION}</p>
    <p className="hint">{tmarText("Le versioni TMAR seguono l'ordine 1, 2, 3… Questa è la versione caricata: una vecchia anteprima non si aggiorna da sola.")}</p>
    <details data-test="tmar-technical-details"><summary>{tmarText("Dettagli tecnici")}</summary>
      <label className="setting">{tmarText("Commit sorgente ")}<input aria-label={tmarText("TMAR source revision")} value={BUILD_IDENTITY.revision} readOnly /></label>
      <p>{tmarText("Built: ")}<time>{BUILD_IDENTITY.builtAt}</time></p>
      <p className="hint">{BUILD_IDENTITY.revision === 'unknown' ? tmarText("Commit non disponibile: compilazione senza metadati Git.") : BUILD_IDENTITY.dirty ? tmarText("Compilata da una copia di lavoro modificata rispetto al commit indicato.") : tmarText("Compilata dal commit indicato, senza modifiche locali.")}</p>
    </details>
  </section>
}
