<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Launcher VPS — sorgenti candidate

Ripristina il selettore italiano osservato il **10 novembre 2026**, mantenendo
layout, collegamenti e separazione delle origini. Corregge gli accenti sostituiti
da `?` e fornisce le due risorse che rispondevano 404:
`/launcher-version.js` e `/tmar-live-versions.json`.

Questi sorgenti non sono stati pubblicati sul VPS. La configurazione effettiva
del launcher, del proxy e dei servizi esistenti non è ancora riprodotta in Git.
Il server qui incluso è una **anteprima isolata su loopback**, non una
sostituzione automatica del processo Python o del proxy esistente.

## Contratto dei dati

`metadata.mjs` legge i due file `current/tmar-preview-version.json` indicati
esplicitamente, senza modificarli o cambiarne i collegamenti. Produce
`{ "stable": metadata | null, "dev": metadata | null }`. Ogni richiesta
rilegge i percorsi: una nuova promozione atomica può quindi apparire nel
selettore senza aggiornare manualmente un numero nella pagina.

I nomi sono quelli delle risposte reali acquisite il 10 novembre:
`revision` (SHA Git completo), `built_at_utc` (data ISO UTC),
`cnckitchen_version`, `tmar_number` e `tmar_channel`. I campi descrittivi
`channel` e `source_branch` sono conservati quando presenti. Una versione TMAR
esplicitamente `null` è non numerata; un campo mancante non equivale a `null`.
Le versioni non vengono ricavate da `package.json`, dal ramo, dal nome della
cartella o dalla data corrente. File assenti, illeggibili, troppo grandi o
non conformi danno `null` per il solo ambiente interessato.

Il JavaScript richiede il JSON **alla stessa origine**, senza cache, con
timeout di 8 secondi e intervallo di 120 secondi. Aggiorna soltanto gli otto
valori delle schede. Su errore mostra `Non disponibile`; lo stesso testo è
presente nell'HTML iniziale, anche se il JS non viene caricato. Le date sono
formattate in `Europe/Rome` usando `built_at_utc` del metadata. Non ricarica la
pagina e non interviene sulle sessioni ScanRuler aperte.

## Verifica locale con Node.js 22 o successivo

Dalla radice del checkout, senza installare dipendenze aggiuntive:

```bash
node --test ops/vps-launcher/check.mjs
node ops/vps-launcher/metadata.mjs --stable-metadata /percorso/stable/current/tmar-preview-version.json --dev-metadata /percorso/dev/current/tmar-preview-version.json
node ops/vps-launcher/server.mjs --stable-metadata /percorso/stable/current/tmar-preview-version.json --dev-metadata /percorso/dev/current/tmar-preview-version.json --port 0
```

Le due opzioni dei metadata sono indipendenti e facoltative: senza un percorso
l'ambiente risulta non disponibile. Il server stampa la porta libera assegnata
su `127.0.0.1`; Ctrl+C lo arresta. Serve soltanto `/`, il JS e il JSON.
Le rotte dell'app, inclusa `/?version=stable`, e i download di esempi non sono
serviti da questa anteprima: restano responsabilità del routing esistente.
Gli URL nell'HTML rimangono quelli del portale, compreso il dominio Dev.

Il controllo usa file temporanei, HTTP locale e un DOM minimo in Node. Prova
codifica UTF-8, URL, schema, aggiornamento dei file, risposte HTTP, errori,
timeout, periodicità e assenza di reload. Non costituisce una prova Chrome
o una verifica HTTPS del VPS. Le versioni storiche del 3 novembre compaiono
esclusivamente come fixture nel controllo; non sono valori di produzione.

## Preflight necessario prima della pubblicazione

1. Verificare in sola lettura l'identità del VPS **31.70.139.73** e
   l'esecutore responsabile di `/opt/tmar-scanruler-preview`,
   `/opt/tmar-scanruler-dev` e `/opt/tmar-scanruler-launcher`. Acquisire
   configurazione realmente caricata dal proxy, percorsi, processi,
   hash dei file e destinazioni correnti dei due collegamenti `current`.
2. Leggere i due metadata effettivi e confrontarli con le release pubblicate.
   Confermare i permessi di sola lettura e i percorsi del launcher esistente.
   Confrontare i sorgenti Python/JS attuali prima di scegliere come integrarli:
   questo candidato Node non cambia il runtime dei servizi per implicazione.
3. Verificare il routing attivo: `/?version=stable` deve continuare ad aprire
   l'app sulla medesima origine Stable; `/assets/...` e `/samples/...` devono
   restare raggiungibili; Dev deve rimanere su
   `https://scanruler-dev.31-70-139-73.sslip.io/`. I due percorsi JS/JSON del
   launcher devono avere precedenza sulla risposta HTML dell'app, sotto
   la stessa origine del selettore.
4. Preparare una modifica limitata ai file e alle rotte accertati, con copia
   dei file precedenti e percorso di ripristino. Validare i tipi MIME UTF-8,
   l'assenza di cache sul JSON e la compatibilità CSP della configurazione
   candidata. Verificare poi launcher, JS, JSON, Stable, Dev ed esempi via
   HTTPS senza ricaricare una sessione di lavoro già aperta.

Nessun file di servizio, configurazione Caddy, hook di build o comando di
deploy è incluso. La pubblicazione resta separata dalla preparazione e dalla
verifica locale di questi sorgenti.

## Provenienza

- HTML del portale acquisito il 10 novembre 2026 dal coordinatore.
- Risposte Stable/Dev acquisite lo stesso giorno, riferite a build del
  3 novembre 2026; utilizzate per fissare lo schema e per le sole fixture.
- `origin/feat/vps-web-preview-fixtures-20261103`, documento
  `docs/tmar-vps-preview-coordination-20261103.md`: contratto del selettore,
  aggiornamento ogni 120 secondi, origini e configurazione VPS preesistente.
