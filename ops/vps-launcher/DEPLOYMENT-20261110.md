<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Correzione del selettore pubblico ScanRuler

Applicata il **10 novembre 2026 alle 21:15:01 UTC / 22:15:01 Europe/Rome**.
URL: https://scanruler.31-70-139-73.sslip.io/

## Causa e intervento

Il servizio `tmar-version-hub.service`, con backend Python sulla porta 8096,
serviva già HTML, JavaScript e JSON. Caddy inoltrava soltanto la radice al
launcher; i due endpoint delle versioni finivano invece sul server statico
dell'app e rispondevano 404. Il Caddyfile host conteneva già le due rotte,
ma il bind mount conservava il file precedente e la configurazione attiva
non le includeva.

Sono stati sostituiti atomicamente `index.html` e `launcher-version.js`, con
codifica UTF-8, fallback comprensibile e aggiornamento dei valori ogni 120
secondi. Il timeout del recupero è di 8 secondi. Le versioni provengono dai
file delle release effettivamente pubblicate, senza numeri scritti nella pagina.
Il testo della scheda Dev presenta l'ambiente di sviluppo senza attribuirgli
l'esclusiva di Edit Surface. La direttiva `frame-ancestors`, non supportata in
un meta tag, è stata rimossa dal meta CSP; l'header HTTP `X-Frame-Options: DENY`
è rimasto attivo, insieme alle altre protezioni preesistenti.

La configurazione host è stata adattata e validata, poi caricata nel processo
Caddy esistente via stdin. Il confronto della configurazione ha dimostrato
l'identità di tutti gli altri host e, nel sito Stable, l'aggiunta delle sole
rotte `/launcher-version.js` e `/tmar-live-versions.json`, verso il backend
già esistente. La rinumerazione interna del gruppo Caddy da `group4` a `group5`
è stata verificata separatamente: il primo preflight si era arrestato prima
di qualsiasi scrittura proprio per questa differenza nominale.

Il Caddyfile host non è stato modificato. Nessun container o servizio launcher
è stato riavviato. Le destinazioni `current` di Stable e Dev sono rimaste
`d87c7bbc016ccd23a31d73608fc5b508d4007d67`; nessuna build applicativa è stata
eseguita per questa correzione.

## Verifica dopo la pubblicazione

Il controllo HTTPS del **10 novembre alle 21:16:01 UTC / 22:16:01 CET** ha
verificato nove risorse con esito HTTP 200: pagina, JavaScript, JSON aggregato,
app Stable, app Dev, i due file di metadati, pagina degli esempi e HEAD dello
ZIP degli esempi. HTML e JavaScript coincidono negli hash con i file installati.
Il JSON aggregato coincide con i due metadati pubblicati; le tre risorse del
launcher espongono MIME UTF-8 e cache disabilitata. Il controllo HEAD dello
ZIP riguarda raggiungibilità e tipo MIME, non il contenuto dell'archivio.

Nel browser, alle **21:16–21:17 UTC / 22:16–22:17 CET**, tutti gli otto campi
erano popolati e gli accenti corretti. Nessun errore applicativo o CSP osservato;
un messaggio di errore proveniva dall'estensione del browser, non dalla pagina.

| Campo | Stable | Dev |
| --- | --- | --- |
| ScanRuler CNC Kitchen | 0.11.1 | 0.11.1 |
| TMAR | Versione 4 — Anteprima | Versione 4 — Anteprima |
| Revisione applicativa | d87c7bbc016ccd23a31d73608fc5b508d4007d67 | d87c7bbc016ccd23a31d73608fc5b508d4007d67 |
| Pubblicazione mostrata, Europe/Rome | 10/11/2026, 14:22 | 10/11/2026, 14:21 |

Queste date identificano la pubblicazione delle app. La correzione della pagina
è successiva e non cambia l'identità delle loro build. Nessun collaudo CAD,
solve T2 o nuova qualifica geometrica è implicito in questa verifica.

## Hash e ripristino

| Artefatto | Byte | SHA-256 |
| --- | ---: | --- |
| HTML pubblicato | 6127 | ae1357c0f4a60a834cae108794cb529dae6587a8213e6ccea61fa43db0f5f382 |
| JavaScript pubblicato | 2961 | 74e576bfd4809d4b26696d375e55cbfc79ff7981ddbf93059f6b1a9d0c019dae |
| Backend Python, invariato | 2569 | b7167c4196e03fba53694e6219bed16b2503adab0a9754f899e6fa7a56bb3b2a |
| Caddyfile host, invariato | — | 44acc7e97f71672ebda8eee9c663a664858db7504484d47cb09ddd7ccb3020fa |
| Configurazione Caddy attiva dopo reload, JSON canonico | — | 517e4299ae546b52f2074201c9958e59094044b3b1ca1eba49935a904e0a2331 |

Backup dei due file e delle configurazioni precedenti sul VPS:
`/opt/tmar-scanruler-launcher/backups/repair-20261110T211501Z`.
La configurazione completa del proxy resta sul server e non viene pubblicata
in questo repository. Il ripristino può riutilizzare i due file salvati e la
configurazione attiva precedente, ricaricando Caddy via stdin senza intervenire
sui container delle applicazioni.
