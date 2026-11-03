// SPDX-License-Identifier: AGPL-3.0-only
// Source-browser QA ONLY. Not imported by main or registered in production.
// Exercises the real host with a small controller, not Edit Surface parity.
import { createElement, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { registerWorkspaceEditor } from '../../src/plugins/workspaceEditors'
import type { EditorSnapshot, EditorViewportLease, PreparedCadCopy, WorkspaceEditorController } from '../../src/plugins/workspaceEditorTypes'
export const probe = {
  lease: null as EditorViewportLease | null, controller: null as (WorkspaceEditorController & { change(delta: number): void }) | null,
  disposals: 0, gestures: 0, moves: 0, interruptions: 0,
  prepareGate: null as Promise<void> | null, prepareStarted: false,
}
export function installProbe(resultStep: Uint8Array): () => void {
  return registerWorkspaceEditor({
    id: 'qa-host-probe', apiVersion: 1, workspace: 'reverse',
    Parameters: ({ controller }) => {
      const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      return createElement('div', { 'data-test': 'probe-parameters' },
        createElement('p', null, 'Controller di collaudo host, non Edit Surface'),
        createElement('output', { 'data-test': 'probe-revision' }, String(s.historyRevision)),
        createElement('button', { 'data-test': 'probe-change', onClick: () => probe.controller!.change(2) }, 'Prova +2 mm'))
    },
    async createSession(ctx) {
      let rev = 1, delta = 0, history = [0], index = 0, frozen = false
      const listeners = new Set<() => void>()
      const current = () => ({ sessionId: ctx.sessionId, sourceEpoch: ctx.source.sourceEpoch, selectionEpoch: 1, draftEpoch: rev })
      let snapshot: EditorSnapshot, mesh: THREE.Mesh | null = null
      const update = (gesture: 'idle' | 'pole' = 'idle') => {
        const stamp = { ...current(), requestId: rev }
        snapshot = { current: current(), revision: rev, dirty: delta !== 0, gesture, validation: { kind: 'valid', stamp },
          canUndo: index > 0, canRedo: index < history.length - 1, undoLabel: null, redoLabel: null,
          historyRevision: index, draftNoteCount: 0, message: 'Controller QA · risultato sintetico' }
        if (mesh) { mesh.scale.z = (10 + delta) / 10; mesh.position.z = 5 + delta / 2 }
        probe.lease?.invalidate(); listeners.forEach(fn => fn())
      }
      let active: { pointer: number; x: number; y: number; start: number; moved: boolean } | null = null
      const change = (value: number) => {
        if (frozen) throw Error('frozen')
        delta = value; rev++; history = [...history.slice(0, index + 1), delta]; index++; update()
      }
      const controller: WorkspaceEditorController & { change(value: number): void } = {
        change, getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
        attach(view) {
          probe.lease = view
          mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 10), new THREE.MeshStandardMaterial({ color: '#70b3d8' }))
          mesh.position.set(10, 15, 5); view.group.add(mesh)
          const unmask = view.maskSourceForPreview()
          const offLayer = view.addLayer({ order: 1, covers: true, dispose() {}, navTargets: () => mesh ? [mesh] : [],
            pointerDown(e) {
              if (frozen || active || e.button !== 0) return false
              const p = view.projectPartPoint([10, 15, 10 + delta])
              if (Math.hypot(e.clientX - p.clientX, e.clientY - p.clientY) > 24 || !view.capturePointer(e.pointerId)) return false
              active = { pointer: e.pointerId, x: e.clientX, y: e.clientY, start: delta, moved: false }
              probe.gestures++; update('pole'); return true
            }, click: () => true, hover: () => true,
          })
          const offPointer = view.onCapturedPointer({
            move(e) {
              if (!active || e.pointerId !== active.pointer || Math.hypot(e.clientX - active.x, e.clientY - active.y) < 4) return
              active.moved = true; delta = 2; rev++; probe.moves++; update('pole')
            },
            up(e) { if (!active || e.pointerId !== active.pointer) return; const moved = active.moved; active = null; if (moved) change(delta); else update() },
            cancel() { controller.cancelGesture() }, lostCapture() { controller.cancelGesture() },
          })
          const offInterrupt = view.onInterruption(() => { probe.interruptions++; controller.cancelGesture() })
          view.invalidate()
          return () => { offInterrupt(); offPointer(); offLayer(); unmask(); if (mesh) { view.group.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh = null }; probe.lease = null }
        },
        cancelGesture() {
          if (!active) return false
          delta = active.start; const id = active.pointer; active = null; rev++
          probe.lease?.releasePointer(id); update(); return true
        },
        undo() { if (!frozen && index > 0) { delta = history[--index]; rev++; update() } },
        redo() { if (!frozen && index + 1 < history.length) { delta = history[++index]; rev++; update() } },
        freeze() { frozen = true; return () => { frozen = false } },
        async prepareApply(ticket, signal): Promise<PreparedCadCopy> {
          probe.prepareStarted = true
          if (probe.prepareGate) await probe.prepareGate
          if (signal.aborted) throw Error('cancelled QA preparation')
          return { kind: 'cad-copy', operationId: ticket.operationId, source: ctx.source, stamp: ticket.stamp, units: 'mm', coordinateFrame: 'part', name: 'host-probe-copy.step', step: delta ? resultStep.slice() : ctx.step.slice(), draftNoteCount: 0 }
        },
        async dispose() { probe.disposals++; listeners.clear() },
      }
      probe.controller = controller; update(); return controller
    },
  })
}
