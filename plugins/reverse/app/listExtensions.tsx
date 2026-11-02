// SPDX-License-Identifier: AGPL-3.0-only
// Optional UI adapters registered before React mounts. No TMAR imports here.
import type { ComponentType, PropsWithChildren } from 'react'
export interface NoteListProps { placementBlocked?: string | null }
export interface FeatureRowProps extends PropsWithChildren { id: number }
let noteList: ComponentType<NoteListProps> | null = null
let featureList: { list: ComponentType<PropsWithChildren>; row: ComponentType<FeatureRowProps> } | null = null
export function registerNoteListExtension(component: ComponentType<NoteListProps>): () => void {
  if (noteList) throw new Error('A note-list extension is already registered.')
  noteList = component
  return () => { if (noteList === component) noteList = null }
}
export const noteListExtension = () => noteList
export function registerFeatureListExtension(extension: NonNullable<typeof featureList>): () => void {
  if (featureList) throw new Error('A feature-list extension is already registered.')
  featureList = extension
  return () => { if (featureList === extension) featureList = null }
}
export function FeatureListExtension({ children }: PropsWithChildren) {
  const List = featureList?.list
  return List ? <List>{children}</List> : <>{children}</>
}
export function FeatureRowExtension({ children, id }: FeatureRowProps) {
  const Row = featureList?.row
  return Row ? <Row id={id}>{children}</Row> : <>{children}</>
}
