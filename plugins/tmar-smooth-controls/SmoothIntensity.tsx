// SPDX-License-Identifier: AGPL-3.0-only
import { useStore } from '../../src/state/store'
import { useMeshTools } from '../mesh-tools/state/meshStore'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'

export function SmoothIntensity() {
  useTmarLanguage()

  const strength = useMeshTools(s => s.smoothStrength)
  const setStrength = useMeshTools(s => s.setSmoothStrength)
  const modelBusy = useStore(s => s.busy)
  const meshBusy = useMeshTools(s => s.editing || s.status === 'running' || s.trimStatus === 'running')
  const busy = modelBusy || meshBusy
  return <section data-test="smooth-intensity-control" aria-label={tmarText("Smoothing intensity")}>
    <label className="field"><span>{tmarText("Intensity ")}<output data-test="smooth-intensity-value">{Math.round(strength * 100)}%</output></span>
      <input className="slider" data-test="smooth-intensity" aria-label={tmarText("Smoothing intensity")} type="range"
        min="0" max="100" step="1" value={Math.round(strength * 100)} disabled={busy}
        onChange={e => setStrength(Number(e.target.value) / 100)}/>
    </label>
    <p className="hint">{tmarText("0%: no smoothing. 100%: full smoothing within the selected size and movement limit. Changing the slider alone does not edit the mesh; press Smooth to apply. Each application is cumulative and has its own Undo step.")}</p>
  </section>
}
