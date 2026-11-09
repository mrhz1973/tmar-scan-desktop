# Edit Surface — modified candidate prepared from the real Tube bundle

Date: **2026-11-09**. Parent checkpoint: `1887859163f8fd260189e5cbd218acdd007a9c91`. Branch: `codex/edit-surface-tubo-periodic`. Scope remains `plugins/tmar-edit-surface/**` in the assigned isolated worktree.

## Result and meaning

Candidate **`tubo-6b-derivative-storage-candidate-1`** is saved as a complete coefficient artifact. The one-shot preparation completed at **18:52:05 UTC** with `preparationCriteriaSatisfied=true` and status **`prepared-unqualified-coefficient-candidate`**. It contains the four source support nets, both modified lateral nets, the original target vectors, all 952 changed-pole records, and the two replacement U seam curves with their pcurve binding plans.

This materializes the real derivative correction already specified in the frozen bundle. It does not invent a translation, solve the old fitting problem again, or declare the new component/native CAD/full Tube accepted. `continuousG1Certified`, `nativeCadCertified` and `tubeAccepted` remain false.

The original packet explicitly identifies 5 mm as an estimate, not a displacement requirement. The other value 5 mm/native-V caps derivative-coefficient change. The requested geometric displacement is the field determined by the existing two-row operator and the supplied target field. See the full [candidate contract](../../EXPERIMENTAL-MODIFIED-CANDIDATE.md) for formulas, parameter maps and criteria.

## Changed and protected geometry

| Bundle side | Modified lateral | Fixed support | STEP join | Changed V rows, zero based | Changed poles |
|---|---|---|---|---|---:|
| V0 | 323/V1 | 322/V0 | #207475 / junction 74 | 9,10 | 476 |
| V1 | 321/V0 | 322/V1 | #207173 / junction 75 | 1,2 | 476 |

All other rows, basis data and source objects are unchanged. The operation is confined to V in [.95,1] on 323 and [0,.05] on 321. The central 322 and protected 324 nets are unchanged. Natural V boundary positions remain identical as coefficients. The opposite rim **323/V0–324/V1, edge#207767**, retains its own acquired contract; its qualification is not transferred to either bundle join.

New source applicability was prepared for 321 and 322: twelve and two exact U clamps respectively, all with zero emission error and exact closed-to-periodic representation identity. The resulting grids are 238×12 and 97×2. For 323, the original saved BREP support was reused and its coefficients matched the raw source exactly. The post-STEP support was not substituted for the bundle's original source.

Both source inward-derivative arrays and reconstructed target arrays match the original bundle's float64 little-endian hashes exactly. The existing storage arithmetic was reused without invoking the consumed full diagnostic wrapper.

| New stored-coefficient result | 323 | 321 |
|---|---:|---:|
| D1 residual upper, mm/native-V | 1.6539825065109432e-12 | 1.701416785238053e-12 |
| D2 change upper, mm/native-V² | 1.394440118929197e-12 | 6.217248937900883e-13 |
| Observed maximum Euclidean pole movement, mm | 0.10000000000000121 | 0.06492088175293244 |
| Conservative pole L1 upper, mm | 0.15486418971886284 | 0.07458976953957834 |

Pole movement is not surface displacement. The continuous 0.05 mm surface/seam criteria and angular criteria are declared for subsequent qualification; these preparation observations do not assert that they pass.

## Topology information recovered without CAD

A read-only text extraction of the frozen STEP recovered the selected face graph,861 referenced entities and edge adjacencies. Its raw support pole hashes match the supplied packet. This recovered the previously missing 321 U seam and exterior boundary without importing the source or repeating old experiments.

- 321 seam: edge#207440, old 3D curve#207442, pcurves#207455/#207462.
- 323 seam: edge#208034, old 3D curve#208036, pcurves#208039/#208046.
- 321 far V1 boundary: edge#204199, adjacent face#204195/support#201289; no new native index is assumed.

The candidate seam curves use the actual stored U0 control column in the same quintic V basis. Both original seam curves matched their source columns exactly. The two pcurves on each seam were verified as data to use U0/Uend, increasing V, unit scale and range [0,1]. Endpoints remain bit-identical. Rebinding those pcurves and constructing coherent native topology remain pending.

## Files and hashes

| Artifact / evidence | SHA-256 |
|---|---|
| Private coefficient artifact, 1,112,885 bytes | `4b1e81b166e373707a9e0df1063bf757de6303e71a02d9a818631b3036b4350a` |
| New one-shot preparation receipt | `9859fb45965821441fc8cd6a6e439ca21bad0c88843c9a672c008a04bcbf5777` |
| Preflight | `1876d5e8ad5f1d76cdc2d606e02067d870cc73d5261297c57dcddcd7e86d4132` |
| New static source capture | `02a34618425c96fe82e7355a9b31467a09399849b7cb3339d6b1fda89e7d1539` |
| Initial130-file preservation baseline | `6511f817a744291bfc93d4e82034e5c212b9c90602520468c120f74cb2a862cd` |

Private data and runners remain under `evidence/modified-candidate-1887859.local/`, with the driver at `tests/experimentalModifiedTubeCandidateOnce.local.ts`. The complete coefficient file is `candidate-1.coefficients.local.json`. The consumed marker is `candidate-preparation-1.local.run-once`; do not clear it or overwrite its receipt.

Public [preparation-summary.json](preparation-summary.json), [input-manifest.json](input-manifest.json), [topology-summary.json](topology-summary.json) and [verification.json](verification.json) carry the recorded results and hashes. Net hashes serialize the ordered fields nu,nv,du,dv,ku,kv,mu,mv,periodic,rational,weights,poles with JSON.stringify. Separate pole/target hashes serialize U-major,V-minor,XYZ binary64 little-endian values.

## Validation and preservation

**Nine new pure tests passed** in two targeted files; final targeted TypeScript checks passed for both helpers/tests and the isolated driver. The initial TypeScript narrowing failure and its subsequent successful check are both retained. The correction only made the unreachable branch explicit; no numerical criterion changed. No acquired test suite was invoked.

The new artifact runner used **zero kernel initializations, zero STEP imports/exports and zero fitting runs**. It verified all eight input files and all 130 inherited protected files before and after preparation. The original EditSurface.tsx WIP, Tube work, markers and receipts are preserved. The historical STOP `reopened-own-support-mismatch` remains at receipt SHA-256 `32f2b99c16c5f4ddf4177c5b8ec2431ebd9cc7c417dcf502595ed779b87fcc92`.

## Next / limits

Bind the next continuous and native qualification contracts to this artifact hash. Reuse acquired saved-pair evidence within its own scope; do not run that pair or the old full storage wrapper again. New work concerns the modified candidate, both bundle joins, regularity/orientation, movement and coherent native seam/support/pcurve construction. The full contract specifies parameter signs, dimensional/angular criteria and the installed API limitations.

No missing geometric datum blocks preparation. Whole-Tube acceptance still needs explicit tolerance bands for nominal 2 mm wall, 4.75 mm hole and 17.09 mm block dimensions, and any required global angular specification; the packet supplies none. The external reference tolerance is ±0.5 mm. Local diagnostic limits do not replace those piece requirements.

Sources actually recovered: the complete 8 November handoff, attached Tube packet and numerical sources, the packet's original archived message excerpts, checkpoint code/receipts and 9 November static source capture. No full previous-chat transcript or automatic delivery to another chat is claimed. Host/kernel/MCP and live CAD were unchanged; no merge was performed.
