# Volume OCCT su un cilindro periodico sintetico

Il test crea in memoria un cilindro di raggio 10 mm e altezza 20 mm, lo esporta e reimporta come STEP e converte il solido con una trasformazione identità. Poi riapre il BREP convertito senza modifiche e, in prove separate, raffina soltanto la base V della faccia periodica con `refineLinearPeriodicV`. Nessun polo viene spostato.

| Stato | `getVolume` (mm³) | Scarto dal volume analitico (mm³) |
|---|---:|---:|
| Sorgente STEP, uguale a πr²h | 6283.185307179587 | 0 |
| Convertito, 2 poli in V | 6337.317410776184 | +54.132103596598 |
| Replay BREP invariato | 6337.317410776189 | +54.132103596602 |
| Raffinato, 5 poli in V | 6285.428904620381 | +2.243597440794 |
| Raffinato, 6 poli in V | 6274.201074418854 | −8.984232760733 |
| Raffinato, 9 poli in V | 6280.632651802891 | −2.552655376696 |

Il replay invariato differisce dal BREP convertito di +4.55 × 10⁻¹² mm³ e rispetta la soglia relativa esistente di 10⁻⁸. Con 9 poli il valore cambia di −56.684758973293 mm³ rispetto al convertito. Il passaggio da STEP analitico a NURBS aveva già modificato la lettura. Nel campione i valori `getVolume` cambiano fra rappresentazioni che coincidono nei punti verificati; i campioni non dimostrano l'identità globale delle superfici.

OCCT valida tutte le varianti, ciascuna con 1 solido, 1 shell, 3 facce, 3 fili, 3 spigoli e 2 vertici. I controlli esistenti sulle tolleranze, sui bordi corrispondenti e sulle due rappresentazioni della cucitura passano. Le orientazioni delle facce coincidono. Su una griglia UV 33 × 17 lo scarto massimo della faccia periodica è 7.33 × 10⁻¹⁵ mm, entro il limite esistente di 10⁻⁸ mm. I controlli geometrici riguardano i punti campionati e un unico cilindro sintetico.

Per riprodurre la misura, eseguire `npm test -- plugins/tmar-edit-surface/tests/periodic-volume-baseline.test.ts`. Il test registra le letture del raffinamento senza fissare lo scarto osservato come risultato obbligatorio.
