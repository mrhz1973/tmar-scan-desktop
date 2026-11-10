// SPDX-License-Identifier: AGPL-3.0-only
// Revalidate managed anchors against the persisted artifact and current exact CAD.
// An unresolved identity is never silently replaced with a nearby face.
import type { Note } from '../core/notes'
import type { ImportFeature } from '../core/features'
import type { DraftCopyFaceNoteV1 } from '../../../src/plugins/annotatedCopyTypes'
import { editorSha256 } from '../../../src/plugins/editorLifetime'
import { useReverse } from '../state/reStore'
import { useNotes } from '../state/noteStore'
import { reverseSession } from './reSession'

// Text/status changes do not alter geometric identity. All other attachment fields do.
const anchorKey = (note: Note): string => {
  const { status: _status, ...binding } = note.attachment ?? {}
  void _status
  return JSON.stringify([note.at, note.normal, note.on, binding])
}

export async function revalidateAnnotations(): Promise<void> {
  const before = useReverse.getState(), session = reverseSession()
  const notes = useNotes.getState().notes.filter(note => note.attachment)
  if (!notes.length || !session) return
  await session.startKernel()
  await session.settled()
  if (useReverse.getState().documentEpoch !== before.documentEpoch) return
  const ready = useReverse.getState(), client = session.client()
  if (!client || ready.building) return
  const groups = new Map<string, Note[]>()
  for (const note of notes) {
    const key = note.attachment!.featureUuid
    groups.set(key, [...(groups.get(key) ?? []), note])
  }
  const resolutions = new Map<string, { face: Note['on'][number]; uv: [number, number] }>()
  for (const [id, list] of groups) {
    try {
      const matches = ready.features.filter((f): f is ImportFeature =>
        f.kind === 'import' && f.annotationSource?.featureUuid === id)
      if (matches.length !== 1) throw Error('Missing or ambiguous annotated feature.')
      const feature = matches[0], source = feature.annotationSource!, text = ready.stepFiles[feature.file.key]
      if (!text || source.stepSha256 !== await editorSha256(new TextEncoder().encode(text)) ||
          source.witnessSha256 !== await editorSha256(new TextEncoder().encode(source.faceBrep)))
        throw Error('Annotation source digest mismatch.')
      const stamp = { sessionId: 'persisted-note-validation', sourceEpoch: 0, selectionEpoch: 0, draftEpoch: 0, requestId: 0 }
      const mapped: DraftCopyFaceNoteV1[] = list.map(note => {
        const a = note.attachment!
        if (a.stepSha256 !== source.stepSha256 || a.witnessSha256 !== source.witnessSha256 ||
            note.on.length !== 1 || note.on[0].kind !== 'face' || note.on[0].body !== feature.id || !note.normal)
          throw Error('Annotation target mismatch.')
        return { draftId: a.noteUuid, text: note.text, target: {
          kind: 'copy-face', witnessKey: 'persisted', sourceUV: a.witnessUV,
          resolvedAt: note.at, orientedNormal: note.normal, resolvedStamp: stamp,
        } }
      })
      const verified = await client.verifyAnnotatedNotes(feature.id, source.faceBrep, mapped)
      for (const note of list) {
        const resolved = verified.notes.find(item => item.draftId === note.attachment!.noteUuid)
        if (!resolved) throw Error('Destination anchor missing after verification.')
        resolutions.set(note.attachment!.noteUuid, {
          face: { kind: 'face', body: feature.id, face: verified.face }, uv: resolved.uv,
        })
      }
    } catch {
      // A failed group is wholly unresolved, including any entries collected so far.
      for (const note of list) resolutions.delete(note.attachment!.noteUuid)
    }
  }
  const now = useReverse.getState()
  if (reverseSession() !== session || session.client() !== client || now.documentEpoch !== ready.documentEpoch ||
      now.buildVersion !== ready.buildVersion || now.building) return
  useNotes.setState(state => {
    const result = state.notes.map(note => {
      const a = note.attachment, original = notes.find(item => item.attachment?.noteUuid === a?.noteUuid)
      if (!a || !original || anchorKey(note) !== anchorKey(original)) return note
      const resolved = resolutions.get(a.noteUuid)
      const status = resolved ? 'verified' as const : 'unresolved' as const
      // This fingerprint comes from verified witness correspondence, never nearest-face fallback.
      const on = resolved ? [resolved.face] : note.on
      const uv = resolved?.uv ?? a.uv
      if (status === a.status && JSON.stringify(on) === JSON.stringify(note.on) &&
          uv[0] === a.uv[0] && uv[1] === a.uv[1]) return note
      return { ...note, on, attachment: { ...a, uv, status } }
    })
    return result.every((note, i) => note === state.notes[i]) ? {} : { notes: result }
  })
}

export function watchAnnotations(): () => void {
  let queued = false, closed = false, version = 0
  const schedule = () => {
    version++
    if (queued || closed) return
    queued = true
    queueMicrotask(async () => {
      if (closed) { queued = false; return }
      const mine = version, state = useNotes.getState()
      if (state.notes.some(note => note.attachment?.status === 'verified')) {
        useNotes.setState({ notes: state.notes.map(note => note.attachment
          ? { ...note, attachment: { ...note.attachment, status: 'unresolved' } } : note) })
      }
      try { await revalidateAnnotations() } catch { /* Keep unresolved; a later settled build retries. */ }
      finally { queued = false; if (!closed && mine !== version) schedule() }
    })
  }
  const a = useReverse.subscribe((state, previous) => {
    if (state.documentEpoch !== previous.documentEpoch || state.buildVersion !== previous.buildVersion ||
        state.bodiesVersion !== previous.bodiesVersion) schedule()
  })
  const keys = (notes: Note[]) => JSON.stringify(notes.filter(note => note.attachment).map(anchorKey))
  const b = useNotes.subscribe((state, previous) => { if (keys(state.notes) !== keys(previous.notes)) schedule() })
  return () => { closed = true; a(); b() }
}
