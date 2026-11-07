// SPDX-License-Identifier: AGPL-3.0-only
// The host is optional on older ScanRuler builds. Integration is type-checked
// against the actual workspace-editor host in the isolated a28c747 checkout.
// @ts-ignore -- this optional host type does not exist in older builds.
import type { DraftStamp, EditorViewportLease } from '../../src/plugins/workspaceEditorTypes'
import type { Net, Point } from './brep'
import type { Preview } from './editorKernel'
import type { Mesh } from 'occt-wasm'
import type { DragMode } from './localFrame'
import type { NetSelectionMode } from './netSelection'
import type { WholeBoundarySide } from './wholeBoundary'
import type {BoundaryCadCandidate,VerifiedBoundaryPick} from './boundaryVisibilityCad'

export interface WorkspaceStripeSettings {
  readonly orientation: 'horizontal' | 'vertical'
  readonly width: number
  readonly color: string
}
export interface WorkspacePointTarget {
  point: Point
  kind: 'scan' | 'cad'
  label: string
  /** Revalidate visibility, geometry, transform and lease before committing. */
  current(): boolean
}
export type WorkspacePointTargetResolver = (point: Point, normal: Point, distance: number,
  kind: 'scan' | 'cad') => WorkspacePointTarget | null
export type WorkspaceSurfacePickKind = 'scan' | 'cad' | 'tangent-plane' | 'tangent-span'
export interface WorkspaceSurfaceTargetPair {
  readonly at:Point
  readonly target:Point
  readonly label:string
}

/** Part-frame bounds only. The optional host action owns all camera framing. */
export interface WorkspaceReticleFrame {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
  readonly stamp: DraftStamp
}

/** Strip paths and delta are borrowed, read-only, in source-part millimetres. */
export interface WorkspaceStripViewState {
  readonly paths: readonly (readonly Point[])[]
  readonly selectedEdge: number
  /** Axis for the D handle and numeric extension, in the part CAD frame. */
  readonly axis: 0 | 1 | 2
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
  /** Exactly the session snapshot's current stamp; never a CAD preview token. */
  readonly reticleStamp?: DraftStamp
  readonly net: Net | null
  readonly preview: Preview | null
  /** Display only: never authorizes Apply or note anchoring. */
  readonly provisionalPreview?: {readonly kind:'provisional';readonly faceMeshes:Mesh[]} | null
  readonly face: number
  readonly selected: readonly number[]
  readonly locked: readonly number[]
  readonly hiddenPoles: readonly number[]
  readonly selectionMode: NetSelectionMode
  readonly navigationOnly?: boolean
  readonly wholeBoundaryDrag?: {readonly side:WholeBoundarySide;readonly canStart:boolean} | null
  readonly wholeFaceDrag?: { readonly canStart: boolean } | null
  readonly dragMode: DragMode
  readonly axis: number
  readonly dragStrength: number
  readonly showNet: boolean
  readonly snap: boolean
  readonly snapDistance: number
  readonly busy: boolean
  readonly placingNote: boolean
  readonly surfaceTarget?: { readonly kind:WorkspaceSurfacePickKind; readonly sourceBodyId:number;readonly pairs?:readonly WorkspaceSurfaceTargetPair[] } | null
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
  /** Current validated free boundaries; paths are stable and read-only until invalidated. */
  readonly directStrip?: { readonly paths: readonly (readonly Point[])[]; readonly revision: number; readonly axis: 0 | 1 | 2 } | null
}

/** The layer never owns the session or edits project stores. */
export interface WorkspaceSurfaceLayerOwner {
  getViewState(): WorkspaceSurfaceViewState
  subscribe(listener: () => void): () => void
  requestFaceSelection(index: number): Promise<void>
  selectPoints(ids: readonly number[], additive: boolean): void
  beginPoleGesture(): boolean
  beginWholeFaceGesture?(net: Net): boolean
  beginWholeBoundaryGesture?(side:WholeBoundarySide): boolean
  prepareWholeBoundaryPicks?(net:Net,candidates:BoundaryCadCandidate[],origin:Point,parallelDirection?:Point):Promise<readonly VerifiedBoundaryPick[]>
  beginVerifiedWholeBoundaryGesture?(pick:VerifiedBoundaryPick):boolean
  cancelPreparedWholeBoundaryPicks?():void
  previewPoles(poles: Point[]): void
  /** null cancels and restores the previous committed net. */
  finishPoleGesture(poles: Point[] | null): void
  placeNote(point: Point | null): Promise<void>
  pickSurfaceTarget?(point: Point | null, resolve: WorkspacePointTargetResolver): Promise<void>
  pickTangentPlane?(point: Point): Promise<void>
  cancelSurfaceTarget?(): void
  reportViewError(message: string): void
  /** Optional hooks for a future shared-view strip handle. */
  beginStripGesture?(edge: number): boolean
  /** Promote the matching cached boundary and begin its gesture synchronously. */
  beginDirectStripGesture?(edge: number, revision: number): boolean
  previewStripDelta?(delta: Point): void
  finishStripGesture?(delta: Point | null): Promise<void>
}

/** Structural opt-in also type-checks against pre-PR30 hosts without this method. */
export type WorkspaceSurfaceView = EditorViewportLease & {
  /** Publishes or clears bounds; never moves the borrowed camera. */
  publishReticleFrame?(frame: WorkspaceReticleFrame | null): void
}
export interface WorkspaceSurfaceLayer {
  /** Cancel and release pointer capture synchronously, restoring any draft gesture. */
  cancelGesture(): boolean
  dispose(): void
}
export type WorkspaceLayerFactory = (view: WorkspaceSurfaceView, owner: WorkspaceSurfaceLayerOwner) => WorkspaceSurfaceLayer
