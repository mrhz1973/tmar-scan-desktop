// SPDX-License-Identifier: AGPL-3.0-only
// DESIGN-ONLY declarations. No runtime module, registry or commit capability is installed.
// Bind generic Camera/Group/Geometry/Layer to host types at implementation time.
export type Dispose = () => void;
export type Vec3 = readonly [number, number, number];
export type Matrix4Columns = readonly [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number
];
export type CommitKind = 'cad-copy' | 'annotated-cad-copy' | 'parametric-surface-edit';
export interface SourceBinding {
  readonly documentEpoch: string;
  readonly sourceEpoch: number;
  readonly bodyId: number;
  readonly bodyKey: string;
  readonly buildVersion: number;
  readonly kernelGeneration: number;
  readonly frameRevision: number;
  readonly stepSha256: string;
  readonly units: 'mm';
  readonly coordinateFrame: 'part';
}
export interface DraftStamp {
  readonly sessionId: string;
  readonly sourceEpoch: number;
  readonly selectionEpoch: number;
  readonly draftEpoch: number;
}
export interface PreviewStamp extends DraftStamp { readonly requestId: number }
export type Validation =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending'; readonly wanted: PreviewStamp }
  | { readonly kind: 'valid'; readonly stamp: PreviewStamp }
  | { readonly kind: 'invalid'; readonly stamp: PreviewStamp; readonly message: string };
export interface EditorSnapshot {
  readonly revision: number;
  readonly current: DraftStamp;
  readonly dirty: boolean;
  readonly gesture: 'idle' | 'pole' | 'strip';
  readonly validation: Validation;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly historyRevision: number;
  readonly draftNoteCount: number;
  readonly message: string | null;
}
export interface EditorCapabilities {
  readonly apiVersion: 1;
  readonly enabled: true;
  readonly commitKinds: readonly CommitKind[];
  // Initial implementation advertises only cad-copy after its acceptance gates pass.
}
export type ExitReason = 'applied' | 'cancelled' | 'source-invalid' | 'open-failed' | 'host-error';
export interface WorkspaceEditorContext {
  readonly apiVersion: 1;
  readonly sessionId: string;
  readonly source: SourceBinding;
  // A dedicated byte copy. Transferring/detaching this buffer cannot affect host resources.
  readonly step: Uint8Array;
  readonly capabilities: EditorCapabilities;
  readonly signal: AbortSignal;
  // Throws when source/document changed or this session has been revoked.
  assertSourceCurrent(): void;
  // LIFO, idempotent cleanup stack shared by failed creation and normal disposal.
  // Returned callback runs/removes this cleanup exactly once.
  own(cleanup: Dispose): Dispose;
  // Invalidates this session and delegates safe closure to the host.
  reportFatal(message: string): void;
}
export interface ReferenceDescriptor<Geometry> {
  readonly id: string;
  readonly kind: 'scan' | 'cad-face';
  readonly bodyId: number | null;
  readonly faceKey: string | null; // Session key only, not durable topology identity.
  readonly revision: number;
  readonly geometry: Geometry; // Borrowed, immutable; never dispose/mutate.
  readonly partFromGeometry: Matrix4Columns;
  readonly visible: boolean;
  isCurrent(): boolean;
}
export interface EditorViewportLease<Camera, Group, Geometry, Layer> {
  readonly canvas: HTMLCanvasElement; // The existing host canvas, borrowed.
  readonly group: Group; // Session group in part coordinates, host detaches on cleanup.
  readonly overlayRoot: HTMLElement; // Session-owned children only.
  camera(): Camera; // Borrowed; no reset/fit/projection mutation.
  bounds(): DOMRectReadOnly;
  rayInPart(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } | null;
  projectPartPoint(point: Vec3): { clientX: number; clientY: number; visible: boolean };
  addLayer(layer: Layer): Dispose;
  onCapturedPointer(handlers: {
    move(event: PointerEvent): void;
    up(event: PointerEvent): void;
    cancel(event: PointerEvent): void;
    lostCapture(event: PointerEvent): void;
  }): Dispose;
  onInterruption(listener: (reason: 'blur' | 'source-invalid' | 'dispose') => void): Dispose;
  onFrame(callback: (time: number) => void): Dispose; // Existing host loop only.
  references(): readonly ReferenceDescriptor<Geometry>[];
  subscribeReferences(listener: () => void): Dispose;
  // Full source-body mask coordinated by host with persistent user visibility.
  maskSourceForPreview(): Dispose;
  capturePointer(pointerId: number): boolean;
  releasePointer(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  claimEditDrag(claimed: boolean): void; // Host arbitrates navigation and competing tools.
  invalidate(): void;
}
export interface ApplyTicket {
  readonly operationId: string;
  readonly source: SourceBinding;
  readonly stamp: PreviewStamp;
  readonly mode: 'cad-copy';
}
export interface PreparedCadCopy {
  readonly kind: 'cad-copy';
  readonly operationId: string;
  readonly source: SourceBinding;
  readonly stamp: PreviewStamp;
  readonly units: 'mm';
  readonly coordinateFrame: 'part';
  readonly name: string;
  readonly step: Uint8Array;
  readonly draftNoteCount: 0; // Nonzero notes require a different negotiated contract.
}
export interface CommitReceipt {
  readonly operationId: string;
  readonly documentEpoch: string;
  readonly artifactSha256: string;
  readonly createdBodyIds: readonly number[];
  readonly historyActionId: string;
  readonly mode: 'cad-copy';
}
export interface WorkspaceEditorController<Camera, Group, Geometry, Layer> {
  getSnapshot(): EditorSnapshot;
  subscribe(listener: () => void): Dispose;
  attach(view: EditorViewportLease<Camera, Group, Geometry, Layer>): Dispose;
  // Returns true if a gesture was cancelled synchronously, releasing capture now.
  cancelGesture(): boolean;
  undo(): void;
  redo(): void;
  // Freeze blocks ALL mutations (including notes/locks/face changes), not just pointer input.
  freeze(ticket: ApplyTicket): Dispose;
  // Must not alter project stores, history, source geometry or input state.
  prepareApply(ticket: ApplyTicket, signal: AbortSignal): Promise<PreparedCadCopy>;
  dispose(reason: ExitReason): Promise<void>;
}
export interface WorkspaceEditorDefinition<Controller, ParametersComponent> {
  readonly id: string;
  readonly apiVersion: 1;
  readonly workspace: 'reverse';
  createSession(context: WorkspaceEditorContext): Promise<Controller>;
  // Concrete host binding: React.ComponentType<{controller: Controller}>.
  readonly Parameters: ParametersComponent;
}
// Runtime host registry, event routing, transaction and capability negotiation
// are deliberately NOT declared as implemented values in this documentation.
