<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# TMAR Scan Desktop

**Un progetto desktop open source, derivato da ScanRuler, per lavorare su scansioni 3D con più controllo sui salvataggi, sulla continuità delle sessioni e sugli aggiornamenti.**

Fork indipendente di [ScanRuler di CNC Kitchen](https://github.com/CNCKitchen/ScanRuler), mantenuto in [mrhz1973/tmar-scan-desktop](https://github.com/mrhz1973/tmar-scan-desktop). Non è una distribuzione ufficiale di CNC Kitchen.

> **Stato al 1° novembre 2026: progettazione e documentazione iniziale.**
> Il repository contiene la base sorgente di ScanRuler e il piano descritto qui. **Non è ancora disponibile una release desktop TMAR installabile.** Salvataggi desktop versionati, pausa/ripresa del lavoro AI, aggiornamenti TMAR e accelerazione CUDA/Metal sono obiettivi da implementare e collaudare, non funzioni già consegnate.

[Stato e roadmap](#stato-e-roadmap) · [Vantaggi e limiti](#perché-unapplicazione-desktop) · [Aggiornamenti](#aggiornamenti-senza-compilazioni-manuali) · [Come provarlo oggi](#come-provarlo-oggi) · [Documentazione originale](README.upstream.md)

## Perché nasce questo fork

L'obiettivo è rendere più pratiche le sessioni lunghe di reverse engineering: salvare il lavoro in modo affidabile, interromperlo consapevolmente e riprenderlo senza ricostruire da zero lo stato operativo. Vogliamo inoltre seguire gli aggiornamenti frequenti di ScanRuler senza chiedere all'utente di compilare il programma o mantenere manualmente un fork.

La direzione scelta è **un'applicazione per Windows e macOS con un contenitore desktop separato dal pacchetto web di ScanRuler**, più servizi per progetti, aggiornamenti e integrazione AI. Le personalizzazioni devono restare il più possibile modulari, così da poter continuare a beneficiare del progetto originale.

Il progetto nasce per uso personale e condivisione con la comunità. Il codice delle modifiche sarà pubblico e, quando disponibili, le release dovranno includere pacchetti già compilati: non soltanto sorgenti destinati agli sviluppatori.

## Questa repository fa per te?

| Esigenza | Scelta consigliata oggi |
| --- | --- |
| Usare subito ScanRuler senza installare nulla | Usa il [progetto originale](https://scanruler.com/) e la sua documentazione. |
| Seguire o contribuire a una versione desktop con gestione persistente dei lavori | Questa repository descrive il progetto e ospiterà le implementazioni. |
| Avere subito un installer TMAR stabile per Windows o Mac | Non è ancora disponibile. Attendi una release esplicitamente qualificata. |
| Ottenere subito un'accelerazione CUDA o Metal | Non è implementata: è una fase successiva, subordinata ai benchmark. |
| Modificare il codice e sperimentare | La base sorgente è disponibile; le istruzioni di sviluppo sono sotto. |

## Perché un'applicazione desktop

**Si tratta dei vantaggi che intendiamo realizzare**, non di un confronto prestazionale già dimostrato.

| Obiettivo desktop | Vantaggio atteso | Limite da considerare |
| --- | --- | --- |
| Finestra dedicata | Separare il lavoro CAD dal browser usato per navigazione e chat | Una finestra desktop può comunque bloccarsi: servono salvataggi e recupero verificati. |
| Progetti su disco e snapshot | Individuare i file, conservare revisioni e recuperare l'ultimo stato valido | I backup vanno verificati; un autosalvataggio non elimina ogni possibile perdita. |
| Pausa e ripresa operative | Ripartire dall'ultima operazione completata e dal piano di lavoro salvato | Non equivale a congelare qualsiasi calcolo nel punto esatto in cui si trova. |
| Aggiornamenti gestiti | Ricevere pacchetti verificati senza compilazioni manuali | Le modifiche upstream incompatibili possono ritardare una release TMAR. |
| Windows e macOS | Usare lo stesso flusso di lavoro e progetti portabili | Percorsi locali, dipendenze e compatibilità devono essere verificati su entrambe le piattaforme. |
| Controllo delle risorse | Rendere visibili consumi, budget e attività di calcolo | Più memoria o una GPU non rendono automaticamente più veloce ogni operazione. |

ScanRuler originale **elabora già localmente** le scansioni, salva progetti `.scanruler` e dispone di recupero nel browser e integrazione MCP: queste non sono invenzioni del fork. Il nostro obiettivo è aggiungere gestione desktop e continuità operativa intorno a quelle capacità. La documentazione ereditata è conservata in [README.upstream.md](README.upstream.md).

La soluzione prevista usa Electron come contenitore: rimane un motore web incorporato nell'applicazione, non una riscrittura completa del CAD in codice nativo. Vanno considerati installazione, spazio su disco, memoria del contenitore e manutenzione di sicurezza. **Il passaggio al desktop non garantisce di per sé maggiore velocità, precisione geometrica o privacy.**

## Stato e roadmap

La base sorgente verificata per questo piano dichiara **ScanRuler 0.9.4** in [package.json](package.json), al commit upstream [`5c1f2f9`](https://github.com/CNCKitchen/ScanRuler/commit/5c1f2f96b7ac336d5c2bad64148ae19790b0443c). Questo numero identifica la base ereditata, non una release desktop TMAR.

| Area | Stato | Risultato previsto |
| --- | --- | --- |
| Fork pubblico e presentazione del progetto | Disponibili | Provenienza, obiettivi e limiti leggibili prima di scegliere il progetto. |
| Funzioni web di ScanRuler | Presenti nel sorgente ereditato | Misurazione, confronto, reverse engineering, strumenti mesh, progetti e MCP; nessuna nuova qualifica desktop implicita. |
| Applicazione desktop | Pianificata | Pacchetti per Windows x64 e macOS Apple Silicon, con requisiti dichiarati e test sulle piattaforme supportate. |
| Salvataggi e recupero su disco | Pianificati | Salvataggio esplicito, autosave configurabile, snapshot e ripristino verificato. |
| Pausa e ripresa del lavoro AI | Pianificate | Checkpoint persistenti, stato delle operazioni e ricostruzione del contesto operativo. |
| Aggiornamenti e rollback | Pianificati | Compilazione e test automatizzati, pacchetti versionati, canali stabile/rapido e aggiornamento in un momento sicuro. |
| Risorse e selezione del backend | Pianificate | Monitoraggio, budget RAM e memoria GPU, concorrenza controllata e percorso CPU. |
| Calcolo GPU su Windows e Mac | Studio successivo | Valutazione WebGPU e moduli CUDA/Metal dove il beneficio sia dimostrato. |
| Analisi a zebra delle superfici | Pianificata | Verifica visiva del risultato di reverse engineering: superfici e raccordi, bande regolabili e immagini per il report, a complemento del confronto quantitativo CAD/mesh. |
| Personalizzazioni e contributi | Pianificati | Estensioni modulari, modifiche tracciate e test per conservarne il comportamento negli aggiornamenti. |

L'ordine di lavoro è: **contenitore desktop → persistenza e recupero → pausa/ripresa → aggiornamenti verificati → ottimizzazioni misurate**. Alcune attività possono procedere insieme, ma la velocità non deve precedere l'affidabilità. Non sono fissate date di consegna in questo README.

## Salvataggi, pausa e ripresa

Il progetto dovrà poter essere salvato su disco con snapshot periodici e prima delle operazioni critiche. Le scritture dovranno evitare di sostituire l'ultima copia valida con un salvataggio incompleto e gestire errori come disco pieno o chiusura improvvisa.

Per un lavoro AI, non basta salvare il modello: occorre conservare anche obiettivo, requisiti, note, operazioni completate, attività ancora da svolgere, controlli eseguiti e versioni dei componenti. La ripresa dovrà verificare lo stato reale del progetto prima di impartire altri comandi, evitando duplicazioni.

**La prima pausa prevista è tra operazioni sicure.** Un calcolo geometrico già avviato potrà dover terminare oppure essere annullato e ripetuto dall'ultimo checkpoint. Non promettiamo la ripresa arbitraria di un'operazione CAD dal suo punto interno di interruzione.

Il checkpoint del progetto non conserva automaticamente una conversazione o la memoria interna di un modello AI. Non elimina inoltre limiti del servizio AI, interruzioni di rete o necessità di avviare una nuova sessione dell'agente. Queste condizioni devono essere rilevate e gestite esplicitamente.

Portabilità fra Windows e Mac non significa sincronizzazione cloud automatica: il trasferimento dei progetti e i riferimenti ai file esterni richiederanno una procedura verificata. Non vogliamo consentire modifiche concorrenti non coordinate allo stesso progetto.

## Aggiornamenti senza compilazioni manuali

**Architettura approvata, ancora da implementare:**

1. **Contenitore desktop:** installazione iniziale per ciascuna piattaforma e aggiornamenti indipendenti, compresi quelli necessari per la sicurezza.
2. **Pacchetto web ScanRuler:** versione locale scaricabile separatamente, senza ricreare l'intero installer a ogni modifica upstream.
3. **Servizi e moduli nativi:** componenti MCP, gestione dei progetti ed eventuali backend GPU versionati e verificati insieme al pacchetto web.
4. **Pipeline GitHub:** rilevazione delle release upstream, integrazione delle personalizzazioni, compilazione, test e pubblicazione dei soli candidati approvati.

Anche con più release upstream nello stesso giorno, l'utente non dovrà seguirle una per una. La pipeline potrà consolidare gli aggiornamenti sull'ultima versione candidata; il canale **stabile** privilegerà versioni consolidate, quello **rapido** renderà disponibili prima le versioni che superano i controlli. Non è prevista una garanzia di aggiornamento istantaneo.

Un aggiornamento dovrà essere scaricato e verificato senza sostituire i componenti usati da un lavoro in corso. L'attivazione avverrà a progetto salvato, con controllo di compatibilità fra applicazione, MCP, moduli e schema del progetto. Pacchetti e manifest dovranno avere verifiche di autenticità e integrità, non provenire da download arbitrari.

**Se l'aggiornamento non supera i controlli, resta in uso l'ultima versione verificata.** I progetti potranno mantenere fissata la versione utilizzata. Prima di una migrazione si conserverà una copia: il rollback dell'applicazione non garantisce che un progetto già migrato sia leggibile da una versione precedente.

L'obiettivo è lavorare offline con i componenti già installati. Download degli aggiornamenti e servizi AI remoti richiederanno comunque la rete. Non sarà necessario possedere un fork personale per usare i futuri pacchetti pubblici.

## GPU e memoria: ottimizzare solo dove serve

La GPU per visualizzare una scena e la GPU per eseguire calcoli geometrici sono due aspetti diversi. Non prevediamo un pulsante che trasformi automaticamente tutto il CAD in calcolo GPU.

La fase prestazionale partirà da misure riproducibili sui colli di bottiglia. I primi candidati da valutare sono distanze, mappe di deviazione, ricerca dei punti vicini e alcune fasi di allineamento. Valuteremo WebGPU per operazioni condivisibili fra piattaforme e backend dedicati **CUDA su Windows con NVIDIA** e **Metal su macOS Apple Silicon**, mantenendo un percorso CPU quando il backend GPU non è disponibile o non conviene.

I budget RAM e memoria GPU dovranno guidare cache, dimensione dei lotti e concorrenza. Non saranno una promessa di riserva fisica esclusiva né un limite assoluto automaticamente applicabile all'intero processo. La gestione della memoria sul Mac dovrà essere qualificata specificamente, senza trattarla come una copia delle impostazioni di una GPU dedicata Windows.

Un'ottimizzazione sarà accettata solo dopo aver misurato **tempo complessivo, consumo di memoria, correttezza del risultato e comportamento in caso di errore**. Non sono disponibili benchmark TMAR che dimostrino accelerazioni; non vengono promessi moltiplicatori di velocità o miglioramenti automatici della precisione.

## Personalizzazioni senza perdere gli aggiornamenti

Preferiamo funzioni nel contenitore desktop e plugin separati quando i punti di estensione lo permettono. Le modifiche al nucleo di ScanRuler resteranno possibili, ma dovranno essere circoscritte, documentate e coperte da test. Riferimento: [architettura dei plugin upstream](plugins/README.md).

Una nuova versione upstream non dovrà cancellare una personalizzazione per riuscire a installarsi. Se introduce un conflitto o cambia un'interfaccia, la distribuzione di quel candidato verrà bloccata finché l'integrazione non sarà verificata. L'automazione riduce la manutenzione manuale degli utenti, non elimina ogni lavoro di manutenzione del progetto.

Le correzioni generali potranno essere proposte anche al progetto originale, secondo le sue regole di contribuzione. Il fork non implica che tali modifiche siano accettate o supportate da CNC Kitchen.

## Analisi a zebra — da implementare

**Aggiunta alla roadmap il 1° novembre 2026. Stato: pianificata, non implementata.** Obiettivo: introdurre una modalità di analisi a zebra per ispezionare visivamente la qualità delle superfici ricostruite e dei loro raccordi, aiutando a individuare ondulazioni e discontinuità indesiderate prima della consegna del risultato.

- [ ] Visualizzazione a zebra sui corpi e sulle superfici CAD, con attivazione/disattivazione e selezione delle parti da esaminare.
- [ ] Orientamento e densità delle bande regolabili, per osservare il risultato da più direzioni.
- [ ] Acquisizione di viste con parametri riproducibili per il report di verifica e per la revisione da parte dell'agente AI.
- [ ] Collaudo su superfici di riferimento con raccordi continui, discontinuità note e spigoli intenzionali, verificando anche gli effetti della tessellazione e delle normali visualizzate su Windows e macOS.

La zebra dovrà affiancare, non sostituire, il confronto quantitativo CAD/mesh e i controlli dimensionali e topologici. Una visualizzazione regolare non sarà considerata da sola una certificazione della continuità geometrica o della conformità al pezzo reale; gli spigoli intenzionali dovranno essere distinti dai difetti da correggere.

## Qualità, sicurezza e dati personali

Prima di qualificare una release desktop dovranno essere disponibili prove di apertura, salvataggio, riapertura, esportazione STEP, pausa/ripresa e recupero dopo un arresto sulle piattaforme dichiarate. Gli aggiornamenti dovranno essere provati anche con progetti esistenti e snapshot precedenti alle migrazioni.

Per le modifiche geometriche, i test dovranno dichiarare dati, tolleranze e risultati: validità dei solidi, copertura e scarti come RMS, P95 e massimo dove pertinenti. Confrontare il CAD con una scansione non certifica da solo l'esattezza del pezzo reale. Le tolleranze dipendono dal caso e non sono un numero universale imposto dal fork.

Le pipeline pubbliche dovranno usare dati sintetici o campioni condivisibili. **Scansioni private, fotografie, credenziali, token, percorsi personali e log non anonimizzati non devono essere pubblicati nel repository o negli artefatti di test.**

L'applicazione desktop non rende locale un servizio AI remoto: quanto l'agente legge può essere trasmesso al suo fornitore. La connessione agli agenti dovrà essere esplicita e controllata; account, modelli e relativi costi restano separati dall'applicazione. Vedere anche le [avvertenze upstream sugli agenti](README.upstream.md#agents).

## Come provarlo oggi

**Per l'uso immediato:** usa [ScanRuler originale](https://scanruler.com/). Questo fork non ha ancora installer desktop TMAR pubblicati.

**Per sviluppatori:** il codice ereditato è ancora un progetto web. Con Node.js 22 o successivo, secondo [package.json](package.json):

```bash
git clone https://github.com/mrhz1973/tmar-scan-desktop.git
cd tmar-scan-desktop
npm ci
npm run dev
```

Questo avvia l'ambiente di sviluppo web, **non** una versione desktop. I comandi ereditati `npm test`, `npm run build` e `npm run e2e:ci` sono descritti nella [documentazione di sviluppo](docs/development.md); alcuni test richiedono fixture o prerequisiti aggiuntivi. L'aggiornamento iniziale del README non costituisce un collaudo del runtime.

Quando saranno disponibili, i pacchetti TMAR saranno pubblicati nelle [release di questa repository](https://github.com/mrhz1973/tmar-scan-desktop/releases), con versione della base upstream, piattaforme collaudate, istruzioni, limitazioni note e sorgente corrispondente. Le procedure di firma e distribuzione per Windows/macOS sono ancora da predisporre; il supporto a Mac Intel o altre piattaforme non è dichiarato in questa fase.

## Contribuire e consultare le fonti

Proposte e pull request sono benvenute. Per una modifica, descrivere il problema concreto, il risultato desiderato, l'effetto sugli aggiornamenti upstream e i test necessari. Per miglioramenti prestazionali, includere hardware, dati condivisibili, tempi e verifica della correttezza.

La documentazione operativa del fork dovrà restare allineata alle release: una funzione passerà da **pianificata** a **disponibile** soltanto con implementazione e verifica documentate. Le istruzioni e i workflow già presenti in [CONTRIBUTING.md](CONTRIBUTING.md) sono ereditati dall'upstream; le eventuali differenze di processo TMAR dovranno essere rese esplicite prima di utilizzarle per nuovi contributi.

| Riferimento | Contenuto |
| --- | --- |
| [README.upstream.md](README.upstream.md) | Copia integrale del README originale presente alla base `5c1f2f9`, conservata per attribuzione e documentazione; non è un elenco di nuove funzioni TMAR. |
| [docs/manual.md](docs/manual.md) | Manuale delle funzioni ereditate. |
| [mcp/README.md](mcp/README.md) | Connessione e strumenti MCP upstream. |
| [plugins/README.md](plugins/README.md) | Punti di estensione del progetto originale. |
| [docs/development.md](docs/development.md) | Sviluppo e test della base web. |
| [CHANGELOG.md](CHANGELOG.md) | Cronologia ereditata del software; non prova la disponibilità delle funzionalità desktop pianificate qui. |

## Licenza e riconoscimenti

Il codice derivato da ScanRuler resta sotto **AGPL-3.0-only**, vedere [LICENSE](LICENSE). Vanno conservati attribuzioni, avvisi e licenze delle dipendenze. Il progetto originario è di **CNC Kitchen / Stefan Hermann e dei suoi contributori**; TMAR Scan Desktop è un'iniziativa indipendente.

Le future distribuzioni TMAR dovranno rendere disponibile il sorgente corrispondente e rispettare gli obblighi delle dipendenze, compresi gli eventuali componenti GPU. Le licenze commerciali descritte in [COMMERCIAL.md](COMMERCIAL.md) riguardano il titolare del progetto originale: non sono un'offerta commerciale di TMAR. La finalità personale e comunitaria di questo fork non introduce restrizioni aggiuntive alla licenza.

Nome e marchi di CNC Kitchen/ScanRuler non vengono presentati come marchi del fork. La copia della documentazione originale viene mantenuta per provenienza e riferimento; la distribuzione desktop dovrà avere un'identità distinta.

---

**Principio del progetto:** preservare il lavoro prima di accelerarlo; automatizzare gli aggiornamenti senza interromperlo; pubblicare soltanto vantaggi dimostrati, distinguendoli sempre dagli obiettivi futuri.
