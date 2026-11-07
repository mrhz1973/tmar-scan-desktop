# Controllo indipendente del volume sul cilindro periodico sintetico

Il [test diagnostico](tests/periodic-volume-independent.test.ts) riprende il cilindro da [10 mm di raggio e 20 mm di altezza](PERIODIC-VOLUME-BASELINE.md), con volume analitico `πr²h = 6283.185307179587 mm³`. Le varianti coprono la sorgente STEP, la conversione BREP, il replay del BREP e i raffinamenti della base V a 5, 6 e 9 poli senza spostare i poli di controllo.

## Misura e convergenza

Per ogni variante, il test somma i volumi orientati dei tetraedri formati dai triangoli dell'intero solido, inclusi i due fondi, e dal centro del cilindro. La somma è indipendente da `getVolume` e usa le coordinate Float32 restituite dal tassellatore OCCT. Il test riapre il BREP per ogni risoluzione e verifica che ciascuno spigolo della mesh compaia due volte con orientazione opposta. Per il solo controllo di incidenza, identifica i duplicati su una griglia da `10⁻⁵ mm`. In tutte le 24 misure gli spigoli senza coppia e i triangoli con vertici coincidenti risultano zero.

| Rappresentazione | `getVolume` meno analitico (mm³) | Errore assoluto della mesh a quattro risoluzioni (mm³) | Triangoli alla risoluzione più fine |
|---|---:|---:|---:|
| Sorgente STEP | 0.000000 | 10.41099 → 2.60373 → 0.65101 → 0.16340 | 2 008 |
| Convertito | +54.132104 | 8.39509 → 2.09956 → 0.52665 → 0.13146 | 2 264 |
| Replay BREP | +54.132104 | 8.39509 → 2.09956 → 0.52665 → 0.13146 | 2 264 |
| Raffinato a 5 poli V | +2.243597 | 27.73879 → 6.79531 → 1.68774 → 0.41535 | 2 742 |
| Raffinato a 6 poli V | −8.984233 | 27.73879 → 6.79531 → 1.68774 → 0.41535 | 2 742 |
| Raffinato a 9 poli V | −2.552655 | 36.95204 → 9.16167 → 1.90143 → 0.44761 | 23 518 |

La deflessione lineare richiesta è `0.1`, `0.025`, `0.00625` e `0.0015625 mm`, con deflessione angolare rispettivamente di `0.2`, `0.1`, `0.05` e `0.025 rad`. A ogni passaggio l'errore scende almeno della metà. La soglia finale del test è `0.5 mm³`, circa lo `0.008%` del volume analitico. Le somme triangolate dei raffinamenti a 5 e 6 poli coincidono entro `6 × 10⁻¹² mm³` a ciascuna risoluzione, mentre `getVolume` differisce di `11.22783 mm³` fra queste due varianti.

## Percorso di integrazione di OCCT

Nel sorgente corrispondente a `occt-wasm 5.7.1`, `getVolume` chiama l'overload `BRepGProp::VolumeProperties` senza parametro di precisione. L'overload passa `Eps = 1.0` e per una faccia con contorni avvia la quadratura di Gauss a ordine fisso. [Wrapper WASM](https://github.com/andymai/occt-wasm/blob/9892357968bc6ef0b52b98d20620a3f9c2385bc9/facade/generated/kernel.cpp#L2346-L2353) · [Overload OCCT](https://github.com/andymai/OCCT/blob/c7f60ffe85f28c67358d1771454044f0521f2fdd/src/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp.cxx#L555-L585) · [Scelta della quadratura](https://github.com/andymai/OCCT/blob/c7f60ffe85f28c67358d1771454044f0521f2fdd/src/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp.cxx#L365-L395)

Per una B-spline, l'ordine V dipende dal grado V e dal numero di nodi V distinti. Nel caso della faccia delimitata, la quadratura usa il massimo fra l'ordine del contorno e l'ordine V, con il limite di `GaussPointsMax`, anche per il ciclo interno che campiona in U. Il raffinamento della base lungo l'asse può quindi cambiare i punti di integrazione lungo la circonferenza. La dipendenza dal reticolo è verificata nel codice e spiega perché una quadratura a ordine fisso possa restituire scarti diversi a geometria equivalente. Le singole letture del kernel sono state misurate dal test, senza ricostruire numericamente la quadratura interna. [Ordine V](https://github.com/andymai/OCCT/blob/c7f60ffe85f28c67358d1771454044f0521f2fdd/src/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp_Face.cxx#L75-L107) · [Campionamento nel dominio delimitato](https://github.com/andymai/OCCT/blob/c7f60ffe85f28c67358d1771454044f0521f2fdd/src/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp_Gauss.cxx#L1233-L1283)

La prova riguarda un solo cilindro sintetico. L'incidenza degli spigoli verifica la chiusura alla risoluzione scelta e la convergenza è empirica, con riferimento analitico noto. L'oracolo rimane confinato al test diagnostico e usa lo stesso kernel per generare la mesh.

```powershell
npm test -- plugins/tmar-edit-surface/tests/periodic-volume-baseline.test.ts plugins/tmar-edit-surface/tests/periodic-volume-independent.test.ts
```
