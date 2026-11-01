// SPDX-License-Identifier: AGPL-3.0-only
// Optional, build-time plugin contributions inside existing workspace panels.
// Registered before React mounts; the host never imports an extension by name.
import { Fragment, type ComponentType } from 'react'

export interface PanelExtension {
  id: string
  slot: string
  component: ComponentType
  order?: number
}

const entries = new Map<string, PanelExtension>()

export function registerPanelExtension(extension: PanelExtension): () => void {
  if (!extension.id || !extension.slot) throw new Error('A panel extension needs an id and a slot.')
  if (entries.has(extension.id)) throw new Error(`Duplicate panel extension "${extension.id}".`)
  entries.set(extension.id, extension)
  return () => { if (entries.get(extension.id) === extension) entries.delete(extension.id) }
}

export function panelExtensions(slot: string): readonly PanelExtension[] {
  return [...entries.values()].filter((entry) => entry.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

export function PluginPanelExtensions({ slot }: { slot: string }) {
  return <>{panelExtensions(slot).map(({ id, component: Content }) =>
    <Fragment key={id}><Content /></Fragment>)}</>
}
