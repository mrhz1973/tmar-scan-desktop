// SPDX-License-Identifier: AGPL-3.0-only
// Shortcuts to the existing part appearance switches, not a second set of
// preferences. Menus, project loading and these keys all use the same stores.
import { coreText, useLanguage } from '../i18n'
import { useStore } from '../state/store'
import { useDeviation } from '../state/deviationStore'
import { Icon } from './icons'
import './splitViewTools.css'

export function SplitViewTools({ side, name }: {
  side: 'scan' | 'reference'
  name: string
}) {
  useLanguage()
  const scanTransparent = useStore(s => s.translucent)
  const scanMesh = useStore(s => s.wireframe)
  const scanBackfaces = useStore(s => s.showBackfaces)
  const referenceTransparent = useDeviation(s => s.nominalSeeThrough)
  const referenceMesh = useDeviation(s => s.nominalMesh)
  const referenceBackfaces = useDeviation(s => s.nominalBackfaces)
  const scan = side === 'scan'
  const label = coreText(scan ? 'Scan' : 'Reference')
  const controls = [
    {
      id: 'transparent', icon: 'transparent' as const, label: 'Transparent',
      on: scan ? scanTransparent : referenceTransparent,
      set: (on: boolean) => scan
        ? useStore.getState().setTranslucent(on)
        : useDeviation.getState().setNominalSeeThrough(on),
    },
    {
      id: 'wireframe', icon: 'mesh' as const, label: 'Triangle wireframe',
      on: scan ? scanMesh : referenceMesh,
      set: (on: boolean) => scan
        ? useStore.getState().setWireframe(on)
        : useDeviation.getState().setNominalMesh(on),
    },
    {
      id: 'backfaces', icon: 'backfaces' as const, label: 'Backface tint',
      on: scan ? scanBackfaces : referenceBackfaces,
      set: (on: boolean) => scan
        ? useStore.getState().setShowBackfaces(on)
        : useDeviation.getState().setNominalBackfaces(on),
    },
  ]
  return (
    <div className="splitcap split-view-tools" data-test={`split-${side}-tools`}>
      <b>{label}</b>
      <span className="split-view-filename" title={name}>{name}</span>
      <div className="split-view-appearance" role="group"
        aria-label={coreText('Display controls for {0}', [label])}>
        {controls.map(control => {
          const title = `${label}: ${coreText(control.label)}`
          return (
            <button key={control.id} type="button"
              data-test={`split-${side}-${control.id}`}
              className={control.on ? 'on' : undefined}
              aria-label={title} title={title} aria-pressed={control.on}
              onClick={() => control.set(!control.on)}>
              <Icon name={control.icon} size={16} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
