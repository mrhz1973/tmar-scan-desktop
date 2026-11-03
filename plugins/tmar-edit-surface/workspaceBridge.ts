// SPDX-License-Identifier: AGPL-3.0-only
// The host is optional on older ScanRuler builds. Integration is type-checked
// against the actual workspace-editor host in the isolated a28c747 checkout.
// @ts-ignore -- this optional host type does not exist in older builds.
import type { EditorViewportLease } from '../../src/plugins/workspaceEditorTypes'
import type { Net, Point } from './brep'
import type { Preview } from './editorKernel'
import type { DragMode } from './localFrame'
import type { NetSelectionMode } from './netSelection'

export interface WorkspaceStripeSettings {
  readonly orientation: 'horizontal' | 'vertical'
  readonly width: number
  readonly color: string
}

/** Strip paths and delta are borrowed, read-only, in source-part millimetres. */
export interface WorkspaceStripViewState {
  readonly paths: readonly (readonly Point[])[]
  readonly selectedEdge: number
  readonly delta: Point
  readonly pending: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly addedArea: number | null
  readonly totalArea: number | null
  readonly hasResult: boolean
}

/** Immutable state consumed by the main-view layer. Coordinates are part-mm. */
export interface WorkspaceSurfaceViewState {
  readonly net: Net | null
  readonly preview: Preview | null
  readonly face: number
  readonly selected: readonly number[]
  readonly locked: readonly number[]
  readonly hiddenPoles: readonly number[]
  readonly selectionMode: NetSelectionMode
  readonly dragMode: DragMode
  readonly axis: number
  readonly dragStrength: number
  readonly showNet: boolean
  readonly snap: boolean
  readonly snapDistance: number
  readonly busy: boolean
  readonly placingNote: boolean
  /** Only anchors resolved against the currently displayed valid preview. */
  readonly notePins: readonly Point[]
  readonly stripes: WorkspaceStripeSettings | null
  /** Optional for compatibility with older layers; provided by the symmetry-capable session. */
  readonly symmetry?: boolean
  readonly mirrorAxis?: number
  readonly mirrorOffset?: number
  readonly symmetryPartners?: readonly number[] | null
  readonly symmetryBlocked?: boolean
  readonly transparency?: number
  readonly strip?: WorkspaceStripViewState | null
}

/** The layer never owns the session or edits project stores. */
export interface WorkspaceSurfaceLayerOwner {
  getViewState(): WorkspaceSurfaceViewState
  subscribe(listener: () => void): () => void
  chooseFace(index: number): Promise<void>
  selectPoints(ids: readonly number[], additive: boolean): void
  beginPoleGesture(): boolean
  previewPoles(poles: Point[]): void
  /** null cancels and restores the previous committed net. */
  finishPoleGesture(poles: Point[] | null): void
  placeNote(point: Point | null): Promise<void>
  reportViewError(message: string): void
  /** Optional hooks for a future shared-view strip handle. */
  beginStripGesture?(edge: number): boolean
  previewStripDelta?(delta: Point): void
  finishStripGesture?(delta: Point | null): Promise<void>
}

export type WorkspaceSurfaceView = EditorViewportLease
export interface WorkspaceSurfaceLayer {
  /** Cancel and release pointer capture synchronously, restoring any draft gesture. */
  cancelGesture(): boolean
  dispose(): void
}
export type WorkspaceLayerFactory = (view: WorkspaceSurfaceView, owner: WorkspaceSurfaceLayerOwner) => WorkspaceSurfaceLayer
