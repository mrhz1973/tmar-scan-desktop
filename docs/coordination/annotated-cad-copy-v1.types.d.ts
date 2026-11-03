// SPDX-License-Identifier: AGPL-3.0-only
// DESIGN-ONLY transport sketch. No registered API/capability or host implementation.
export type Vec3 = readonly [number, number, number]
export interface SourceBindingV1 {
  readonly documentEpoch: string; readonly sourceEpoch: number
  readonly bodyId: number; readonly bodyKey: string
  readonly buildVersion: number; readonly kernelGeneration: number; readonly frameRevision: number
  readonly stepSha256: string; readonly units: 'mm'; readonly coordinateFrame: 'part'
}
export interface PreviewStampV1 {
  readonly sessionId: string; readonly sourceEpoch: number
  readonly selectionEpoch: number; readonly draftEpoch: number; readonly requestId: number
}
export interface AnnotatedTicketV1 {
  readonly annotationVersion: 1
  readonly mode: 'annotated-cad-copy'
  readonly operationId: string
  readonly source: SourceBindingV1
  readonly stamp: PreviewStampV1
  readonly notesRevision: number
}
export interface FinalFaceWitnessV1 {
  readonly key: string
  readonly kind: 'occt-face-brep'
  readonly brep: string
  readonly brepSha256: string // Host MUST recompute; not trusted from plugin.
  readonly finalStepSha256: string // Host MUST recompute and compare.
  readonly stamp: PreviewStampV1
  readonly diagnosticFaceIndex: number // NEVER a persistent identity.
}
export interface DraftCopyFaceNoteV1 {
  readonly draftId: string // Unique only inside this session bundle.
  readonly text: string
  readonly done?: boolean
  readonly reply?: string
  readonly target: {
    readonly kind: 'copy-face'
    readonly witnessKey: string
    readonly sourceUV: readonly [number, number] // Recompute destination UV after import.
    readonly resolvedAt: Vec3
    readonly orientedNormal: Vec3
    readonly resolvedStamp: PreviewStampV1
  }
}
export interface PreparedAnnotatedCopyV1 {
  readonly annotationVersion: 1
  readonly kind: 'annotated-cad-copy'
  readonly operationId: string
  readonly source: SourceBindingV1
  readonly stamp: PreviewStampV1
  readonly notesRevision: number
  readonly units: 'mm'; readonly coordinateFrame: 'part'
  readonly name: string
  readonly step: Uint8Array // Owned standalone byte copy; no mutation of project resources.
  readonly witnesses: readonly [FinalFaceWitnessV1] // First capability: one selected face.
  readonly notes: readonly [DraftCopyFaceNoteV1, ...DraftCopyFaceNoteV1[]]
}
export interface AnnotatedReceiptV1 {
  readonly mode: 'annotated-cad-copy'; readonly annotationVersion: 1
  readonly operationId: string; readonly documentEpoch: string
  readonly envelopeSha256: string; readonly artifactSha256: string
  readonly createdBodyId: number; readonly createdFeatureUuid: string
  readonly notes: readonly { readonly draftId: string; readonly noteUuid: string; readonly displayId: number }[]
  readonly historyActionId: string
}
// Optional method name/signature requires agreement; do not widen existing prepareApply.
export interface ProposedAnnotatedPreparation {
  prepareAnnotatedApply(ticket: AnnotatedTicketV1, signal: AbortSignal): Promise<PreparedAnnotatedCopyV1>
}
