<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Patch Network: checkpoint del movimento 3D dei punti

4 novembre 2026. Integrazione isolata, non release e non aggiornamento della Versione 1.
Base: `5f39ff521d0095e01fb9b7f1a5af833bca9e28ba` (host annotato 5684f5f + Edit Surface 324a2e0).
La precedente PR #18 resta il record della fondazione matematica: questa consegna ne collega il funzionamento al prodotto.

## Recupero conservativo

Prima di modificare codice sono stati recuperati 26 file locali non pubblicati, inclusi i quattro file della fondazione e il lavoro runtime già presente. I file e l'indice della copia originale non sono stati modificati. Lo snapshot iniziale è identificato da SHA256 `1791956bf388f4b0100cd5df06aea7aa53bdf9e3977d063fcc004a0f50a6d6cba0`; le modifiche riprendono in un nuovo worktree e ramo. Gli a capo dei soli sorgenti copiati sono normalizzati a LF; gli STEP esportati non vengono ripuliti.

Il lavoro recuperato comprendeva già fitting, schema, UI e primi collaudi. I risultati riportati sotto sono nuove esecuzioni di questo checkpoint, non una riclassificazione dei vecchi log. Nessun file di Edit Surface è modificato da questo incremento Patch Network.

## Funzioni disponibili

Nel pannello Patch Network compare **Movimento 3D dei punti**. Sono selezionabili i nodi della rete, i punti intermedi delle curve e i centri interni delle celle suddivise che il fitting produce. Una freccia indica l'asse: si trascina il punto, non la freccia.

- Sulla scansione mantiene la modalità preesistente di proiezione dell'ancora. Un eventuale offset 3D preesistente viene conservato; **Riporta all'ancora** lo azzera con Undo.
- X/Y/Z sono gli assi del pezzo, non della camera. Le componenti numeriche sono spostamenti dall'ancora; cambiare la modalità non muove né reinterpreta il punto.
- Normale usa la normale della mesh all'ancora, fissata all'inizio del gesto. Non è la normale NURBS di Edit Surface, né una garanzia di verso esterno della scansione.
- Un passo numerico può essere positivo o negativo. Il drag cattura un solo puntatore, applica la soglia in pixel CSS e crea una sola azione Undo locale al rilascio. Esc annulla il gesto.
- Se asse e raggio della vista sono quasi paralleli il drag è rifiutato con un messaggio: usare la quota o cambiare vista. Il fallback di trascinamento in profondità di Edit Surface non viene implicitamente attribuito a Patch Network.
- I punti legati a bordi/facce CAD restano protetti: non si sbloccano i vincoli per spostarli liberamente.

La base topologica resta sulla scansione; gli offset vengono trasferiti una sola volta ai vincoli del fitting accoppiato. Le curve condivise e i centri derivati sono coerenti tra patch adiacenti. Anteprima e CAD usano il risultato deformato; il salvataggio conserva gli offset, non solo una tessellazione. I punti intermedi guidano il fitting e non garantiscono interpolazione esatta.

## Magnete: separazione esplicita

**Funziona:** proiezione continua sulla mesh nella modalità preesistente; movimento libero numerico/drag in XYZ e normale; conservazione dei vincoli CAD esistenti.

**Non implementato qui:** magnete 3D di prossimità verso scan/altri CAD, portata, Alt per sospenderlo, snapping esatto a vertici/bordi B-rep. Il pannello lo dichiara. Le prove e le capacità del magnete di Edit Surface non sono estese automaticamente a Patch Network.

## Cronologia e correzione verificata

Una nuova regressione ha riprodotto un difetto del lavoro recuperato: Ctrl+Z poteva cambiare i dati nel mezzo del drag. Il test unitario falliva e il percorso browser si fermava dopo sei controlli. Questa esecuzione resta in `initial-history-failure.json`.

La correzione blocca Undo/Redo globali e locali durante il gesto, aggiorna reattivamente la toolbar e protegge anche le funzioni pure della cronologia. Esc resta proprietario dell'annullamento. Il rilascio produce un solo passo locale; **Save changes** produce un solo passo della cronologia del progetto. Le guardie contro un'anteprima superata restano attive prima della conferma.

## Persistenza

I record `offset`, `viaOffsets` e `centreOffset` dichiarano versione 1, `units: mm`, `coordinateFrame: part`, ancora, direzione unitaria e distanza. I parser rifiutano valori non finiti, versioni sconosciute, disallineamento di punti/offset e spostamenti incompatibili con vincoli CAD. I progetti vecchi senza offset mantengono il percorso precedente. Le trasformazioni del pezzo trasformano anche ancore e vettori di spostamento.

## Nuove verifiche concluse

Ambiente Windows/Chrome isolato, Node 26.8.1, dipendenze bloccate, occt-wasm 5.7.1. Nessun profilo personale o progetto CAD attivo utilizzato.

| Verifica | Risultato |
| --- | --- |
| TypeScript | PASS |
| Build completa | PASS, con avvisi ereditati |
| Test matematici della fondazione | 24 PASS |
| Suite mirata rete, CAD annotato e cronologia | 129 PASS, 1 benchmark preesistente saltato, 18 file |
| Browser sorgente: proiezione, nodi, grip, drag, Ctrl+Z/Esc, centri e Save/Load | 27 controlli PASS |
| Browser compilato: quote, grip, Undo/Redo progetto, Save/Load ed export | 14 controlli PASS |
| Errori applicativi nei due percorsi browser | Zero |

Il caso sorgente modifica una rete sintetica a quattro patch. La copia riaperta ha quattro facce cucite, gap condiviso misurato `0.0009676439875026526 mm` e peggior angolo `0.043564208632213296 gradi`; l'export STEP viene verificato da OCCT indipendentemente. Questi sono risultati del caso, non tolleranze garantite per tutte le reti.

Il browser sorgente prova anche un centro interno a +0.5 mm. La fixture triangolare piana produce già due patch prima del movimento e ne conserva due: non qualifica tutti i tre settori. Un test OCCT separato su calotta curva verifica tre facce cucite. Il test compilato copre quote/nodi/grip, non ripete drag/centro con mouse.

La fixture del compilato è il nuovo progetto prodotto dalla medesima copia sorgente verificata. Non usa un baseline di una revisione sperimentale diversa. Il compilato usa controlli pubblici e nessuna importazione di moduli sorgente; la fixture sorgente è inizializzata esplicitamente e le successive interazioni sono reali.

## Evidenze e limiti

`evidence/patch-network-3d-resume-20261104/` contiene risultati anonimizzati, manifest dei sorgenti e degli originali/pubblicati, screenshot ispezionati, progetto di baseline sintetico, progetto riaperto nel compilato e STEP sintetico. Non include profili, credenziali o geometrie del proprietario. La schermata conserva la scheda supporto ereditata e la scritta Versione 1: non indicano una distribuzione all'utente.

Il revisore delegato in sola lettura è stato tentato con un limite di esecuzione ed è terminato senza rapporto; nessuna revisione indipendente tramite subagente è rivendicata. Restano la revisione diretta, i test negativi e le esecuzioni descritte.

Non sono qualificati tutte le topologie/offset grandi, prestazioni su scansioni estese, continuità G1 generale ai vertici straordinari, magnete 3D o fallback di profondità. La CI generale conserva il problema preesistente del confine plugin nello script della galleria: i risultati mirati non la sostituiscono. Nessuna modifica a layout/timeline/Settings, kernel, cilindri, host annotato congelato, main o sessioni CAD attive. Nessun merge, deployment o rilascio desktop.
