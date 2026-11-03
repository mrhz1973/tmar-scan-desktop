// SPDX-License-Identifier: AGPL-3.0-only
// Type-level contract tests only: tsc --strict --noEmit --lib ES2022,DOM this-file.ts
import type { AnnotatedTicketV1, PreparedAnnotatedCopyV1, DraftCopyFaceNoteV1 } from './annotated-cad-copy-v1.types'
declare const good: PreparedAnnotatedCopyV1
declare const ticket: AnnotatedTicketV1
const acceptable: PreparedAnnotatedCopyV1 = good
void acceptable; void ticket
// @ts-expect-error The old geometry-only mode is not an annotated ticket.
const wrongMode: AnnotatedTicketV1 = { ...ticket, mode: 'cad-copy' }
// @ts-expect-error Explicit millimetres, never implicit metres.
const wrongUnits: PreparedAnnotatedCopyV1 = { ...good, units: 'm' }
// @ts-expect-error Display/world coordinates cannot be persisted as part-frame anchors.
const wrongFrame: PreparedAnnotatedCopyV1 = { ...good, coordinateFrame: 'world' }
// @ts-expect-error Empty note list belongs to ordinary cad-copy, not this protocol.
const empty: PreparedAnnotatedCopyV1 = { ...good, notes: [] }
// @ts-expect-error First capability has one verified selected-face witness.
const noWitness: PreparedAnnotatedCopyV1 = { ...good, witnesses: [] }
const other: DraftCopyFaceNoteV1 = { ...good.notes[0], target: {
  ...good.notes[0].target,
  // @ts-expect-error External CAD/scan is not silently admitted by this capability.
  kind: 'scan',
} }
void wrongMode; void wrongUnits; void wrongFrame; void empty; void noWitness; void other
