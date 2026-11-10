// SPDX-License-Identifier: AGPL-3.0-only
// Test-only controller for the REAL host contract; never registered by production.
// Its CAD and face witness come from actual OCCT. It is not the Edit Surface adapter.
import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { registerWorkspaceEditor } from '../../src/plugins/workspaceEditors'
import type { EditorSnapshot, WorkspaceEditorController } from '../../src/plugins/workspaceEditorTypes'
import type { AnnotatedTicketV1, PreparedAnnotatedCopyV1 } from '../../src/plugins/annotatedCopyTypes'
import { editorSha256 } from '../../src/plugins/editorLifetime'

type Input = { step: string; brep: string; uv: [number, number]; at: [number, number, number]; normal: [number, number, number] }
type Controller = WorkspaceEditorController & { setText(text: string): void; text(): string }
export function installAnnotatedEditorProbe(input: Input): () => void {
  return registerWorkspaceEditor({
    id: 'qa-annotated-copy', apiVersion: 1, workspace: 'reverse',
    Parameters: ({ controller: baseController }) => {
      const controller = baseController as Controller
      useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      return <section data-test="annotation-probe-parameters">
        <p>Collaudo del contratto host, non adapter Edit Surface.</p>
        <label>Nota sulla faccia CAD
          <textarea data-test="annotation-probe-text" value={controller.text()} onChange={e => controller.setText(e.target.value)} />
        </label>
        <p>La nota è ancora una bozza; soltanto Applica pubblica copia e nota insieme.</p>
      </section>
    },
    async createSession(context) {
      const listeners = new Set<() => void>()
      let text = '', notesRevision = 0, revision = 0, frozen = false, disposed = false
      let currentTicket: AnnotatedTicketV1 | null = null
      let snapshot: EditorSnapshot
      const update = () => {
        const current = { sessionId: context.sessionId, sourceEpoch: context.source.sourceEpoch, selectionEpoch: 1, draftEpoch: 1 }
        snapshot = { revision: ++revision, current, dirty: true, gesture: 'idle',
          validation: { kind: 'valid', stamp: { ...current, requestId: 1 } }, canUndo: false, canRedo: false,
          undoLabel: null, redoLabel: null, historyRevision: 0, draftNoteCount: 1, notesRevision,
          message: frozen ? 'Copia e nota congelate per la pubblicazione' : 'Nota locale sul risultato CAD di prova' }
        listeners.forEach(listener => listener())
      }
      const assertLive = () => { if (disposed || context.signal.aborted) throw Error('QA session disposed'); context.assertSourceCurrent() }
      const controller: Controller = {
        getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
        text: () => text,
        setText(value) { assertLive(); if (frozen) throw Error('QA draft frozen'); text = value; notesRevision++; update() },
        attach(view) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 12), new THREE.MeshStandardMaterial({ color: '#6faaca' }))
          mesh.position.set(10, 15, 6)
          const pin = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: '#f29a55' }))
          pin.position.set(...input.at)
          view.group.add(mesh, pin)
          const unmask = view.maskSourceForPreview()
          view.invalidate()
          return () => { unmask(); mesh.removeFromParent(); pin.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); pin.geometry.dispose(); pin.material.dispose() }
        },
        cancelGesture: () => false, undo() {}, redo() {},
        freeze() { throw Error('Notes require the annotated transport') },
        async prepareApply() { throw Error('No geometry-only fallback for draft notes') },
        freezeAnnotated(ticket) {
          assertLive()
          if (frozen || ticket.notesRevision !== notesRevision || !text.trim()) throw Error('QA annotation draft not ready')
          frozen = true; currentTicket = ticket; update()
          return () => { frozen = false; currentTicket = null; update() }
        },
        async prepareAnnotatedApply(ticket, signal): Promise<PreparedAnnotatedCopyV1> {
          assertLive()
          if (!frozen || currentTicket !== ticket || ticket.notesRevision !== notesRevision) throw Error('QA ticket mismatch')
          const step = new TextEncoder().encode(input.step)
          const stepHash = await editorSha256(step), brepHash = await editorSha256(new TextEncoder().encode(input.brep))
          assertLive(); if (signal.aborted) throw Error('QA preparation cancelled')
          return { annotationVersion: 1, kind: 'annotated-cad-copy', operationId: ticket.operationId,
            source: context.source, stamp: ticket.stamp, notesRevision, units: 'mm', coordinateFrame: 'part',
            name: 'annotated-result.step', step,
            witnesses: [{ key: 'qa-final-face', kind: 'occt-face-brep', brep: input.brep, brepSha256: brepHash,
              finalStepSha256: stepHash, stamp: ticket.stamp, diagnosticFaceIndex: 999 }],
            notes: [{ draftId: 'qa-note-1', text, target: { kind: 'copy-face', witnessKey: 'qa-final-face',
              sourceUV: input.uv, resolvedAt: input.at, orientedNormal: input.normal, resolvedStamp: ticket.stamp } }],
          }
        },
        async dispose() { disposed = true; listeners.clear() },
      }
      update()
      return controller
    },
  })
}
