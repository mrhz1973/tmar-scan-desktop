// SPDX-License-Identifier: AGPL-3.0-only
// Optional UI adapters registered before React mounts. No TMAR imports here.
import { Children, Fragment, isValidElement, type ComponentType, type PropsWithChildren, type ReactNode } from 'react'
export interface NoteListProps { placementBlocked?: string | null }
export interface FeatureRowProps extends PropsWithChildren { id: number }
export interface FeatureListEntry { id: number; content: ReactNode }
export interface FeatureListProps extends PropsWithChildren { entries: readonly FeatureListEntry[] }
let noteList: ComponentType<NoteListProps> | null = null
let featureList: { list: ComponentType<FeatureListProps>; row: ComponentType<FeatureRowProps> } | null = null
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
/** Only explicitly tagged rows are offered to a grouped display. Do not call
 * components, guess IDs from React keys or copy rollback/playback controls. */
export function featureListEntries(children: ReactNode): FeatureListEntry[] {
  const entries: FeatureListEntry[] = []
  const visit = (nodes: ReactNode) => Children.forEach(nodes, (node) => {
    if (!isValidElement<PropsWithChildren>(node)) return
    if (node.type === FeatureRowExtension) {
      const props = node.props as FeatureRowProps
      entries.push({ id: props.id, content: props.children })
    } else if (node.type === Fragment || typeof node.type === 'string') visit(node.props.children)
  })
  visit(children)
  return entries
}
export function FeatureListExtension({ children }: PropsWithChildren) {
  const List = featureList?.list
  return List ? <List entries={featureListEntries(children)}>{children}</List> : <>{children}</>
}
export function FeatureRowExtension({ children, id }: FeatureRowProps) {
  const Row = featureList?.row
  return Row ? <Row id={id}>{children}</Row> : <>{children}</>
}
