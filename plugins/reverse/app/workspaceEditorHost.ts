// SPDX-License-Identifier: AGPL-3.0-only
// Reverse's host adapter. Does not import or modify the Edit Surface plugin.
import * as THREE from 'three'
import { sceneOf } from '../../../src/commands/host'
import { commandRunning } from '../../../src/commands/activity'
import { abortIfNeeded, editorSha256 } from '../../../src/plugins/editorLifetime'
import { configureWorkspaceEditorHost, type BoundEditorSource, type WorkspaceEditorHost } from '../../../src/plugins/workspaceEditors'
import type { Matrix4Columns, ReferenceDescriptor } from '../../../src/plugins/workspaceEditorTypes'
import { createEditorViewportLease } from '../../../src/viewer/editorViewportLease'
import { useStore } from '../../../src/state/store'
import { useShell } from '../../../src/state/shellStore'
import { useReverse, reEditorOpen } from '../state/reStore'
import { reverseSession } from './reSession'
import { reSceneOf } from '../viewer/reScene'
import { prepareWorkspaceSurfaceHistory, recoverWorkspaceSurfaceHistory } from './surfaceHistoryWorkspace'

let sourceEpoch = 0, nextKernel = 0
const kernels = new WeakMap<object, number>()
const kernelGeneration = (client: object) => {
  if (!kernels.has(client)) kernels.set(client, ++nextKernel)
  return kernels.get(client)!
}
const shown = (object: THREE.Object3D): boolean => {
  let p: THREE.Object3D | null = object
  while (p) { if (!p.visible) return false; p = p.parent }
  return true
}
export function createReverseEditorHost(): WorkspaceEditorHost {
  return {
    capabilities: Object.freeze({ apiVersion: 1, enabled: true, annotationVersion: 1 as const, commitKinds: Object.freeze(['cad-copy','annotated-cad-copy'] as const) }),
    async readSource(bodyId, signal) {
      if (useShell.getState().workspace !== 'reverse') throw new Error('Apri Reverse Engineer prima di Edit Surface.')
      if (commandRunning() || useStore.getState().busy) throw new Error('Attendi la conclusione dell’operazione corrente.')
      const session = reverseSession()
      if (!session) throw new Error('Sessione CAD non disponibile.')
      if (reEditorOpen(useReverse.getState()) || useReverse.getState().playback) throw new Error('Concludi la bozza CAD già aperta.')
      const openingDocument = useReverse.getState().documentEpoch
      await session.startKernel(); abortIfNeeded(signal)
      if (reverseSession() !== session || useReverse.getState().documentEpoch !== openingDocument) throw new Error('Il documento è cambiato durante l’apertura.')
      await session.settled(); abortIfNeeded(signal)
      if (reverseSession() !== session || useReverse.getState().documentEpoch !== openingDocument) throw new Error('Il documento è cambiato durante l’apertura.')
      const before = useReverse.getState(), model = useStore.getState(), client = session.client()
      if (!client || before.building || !before.bodies.some(b => b.id === bodyId)) throw new Error('Corpo CAD corrente non disponibile.')
      const assertCurrent = () => {
        abortIfNeeded(signal)
        const now = useReverse.getState(), scan = useStore.getState()
        if (reverseSession() !== session || session.client() !== client || now.documentEpoch !== before.documentEpoch ||
            now.buildVersion !== before.buildVersion || now.building || now.features !== before.features ||
            now.rolledBack !== before.rolledBack || now.stepFiles !== before.stepFiles || now.parameters !== before.parameters ||
            scan.fileName !== model.fileName || scan.appliedAlignment !== model.appliedAlignment ||
            scan.elements !== model.elements || scan.sections !== model.sections ||
            scan.vertexCount !== model.vertexCount || scan.triangleCount !== model.triangleCount ||
            !now.bodies.some(b => b.id === bodyId) || useShell.getState().workspace !== 'reverse')
          throw new Error('La sorgente CAD o il documento è cambiato: riapri la modifica.')
      }
      const source = await client.bodyEditSource(bodyId)
      assertCurrent()
      const step = new TextEncoder().encode(source.text), digest = await editorSha256(step)
      assertCurrent()
      const binding = Object.freeze({ documentEpoch: before.documentEpoch, sourceEpoch: ++sourceEpoch, bodyId, bodyKey: source.bodyKey,
        buildVersion: before.buildVersion, kernelGeneration: kernelGeneration(client), frameRevision: before.buildVersion,
        // units-ok: this is a serialized CAD coordinate-frame identifier, always in millimetres.
        stepSha256: digest, units: 'mm' as const, coordinateFrame: 'part' as const })
      return { binding, step, assertCurrent, subscribe: listener => {
        const stops = [useReverse.subscribe(listener), useStore.subscribe(listener), useShell.subscribe(listener)]
        return () => stops.forEach(stop => stop())
      } }
    },
    prepareHistory: prepareWorkspaceSurfaceHistory,
    recoverHistory: recoverWorkspaceSurfaceHistory,
    viewport(source) {
      source.assertCurrent()
      const scene = sceneOf()
      if (!scene) throw new Error('Vista principale non disponibile.')
      const reScene = reSceneOf(scene), group = scene.layerHost().partGroup
      const geometryIds = new WeakMap<object, number>(); let nextGeometry = 0
      const identity = (object: object) => { if (!geometryIds.has(object)) geometryIds.set(object, ++nextGeometry); return geometryIds.get(object)! }
      const references = (): ReferenceDescriptor[] => {
        source.assertCurrent(); group.updateWorldMatrix(true, true)
        const inverse = group.matrixWorld.clone().invert(), refs: ReferenceDescriptor[] = []
        const add = (mesh: THREE.Mesh, id: string, kind: 'scan' | 'cad-face', bodyId: number | null, current: () => boolean) => {
          const geometry = mesh.geometry
          const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)
          refs.push(Object.freeze({ id, kind, bodyId, faceKey: null, revision: identity(geometry), geometry,
            partFromGeometry: Object.freeze(matrix.toArray()) as unknown as Matrix4Columns,
            visible: shown(mesh), isCurrent: () => current() && mesh.geometry === geometry && shown(mesh) }))
        }
        const scan = scene.scanDisplay()?.mesh
        if (scan) add(scan, 'scan', 'scan', null, () => scene.scanDisplay()?.mesh === scan)
        for (const [id, mesh] of reScene.bodyMeshes) {
          if (id === source.binding.bodyId) continue // No coincident source-body snap.
          add(mesh, `cad:${id}`, 'cad-face', id, () => reScene.bodyMeshes.get(id) === mesh)
        }
        return refs
      }
      return createEditorViewportLease(scene, {
        assertCurrent: source.assertCurrent, references,
        subscribeReferences: listener => { const a = useReverse.subscribe(listener), b = useStore.subscribe(listener); return () => { a(); b() } },
        maskSource: () => reScene.leaseBodyRenderMask(source.binding.bodyId),
        sourceVisible: () => { const s = useReverse.getState(); return !s.bodiesHidden && !!s.bodies.find(b => b.id === source.binding.bodyId)?.visible },
      })
    },
    async stageAnnotated(source, plan, signal, display) {
      source.assertCurrent(); abortIfNeeded(signal)
      const session = reverseSession()
      if (!session) throw new Error('Sessione CAD non disponibile.')
      return session.stageEditorCopy(new TextDecoder('utf-8', { fatal: true }).decode(plan.prepared.step), plan.prepared.name, source.assertCurrent, signal,
        display?.hideSourceAfterApply ? { hideSourceBodyId: source.displayBodyId ?? source.binding.bodyId } : undefined, plan)
    },
    async stage(source: BoundEditorSource, prepared, signal, display) {
      source.assertCurrent(); abortIfNeeded(signal)
      const session = reverseSession()
      if (!session) throw new Error('Sessione CAD non disponibile.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(prepared.step)
      return session.stageEditorCopy(text, prepared.name, source.assertCurrent, signal,
        display?.hideSourceAfterApply ? { hideSourceBodyId: source.displayBodyId ?? source.binding.bodyId } : undefined)
    },
  }
}
export function installReverseEditorHost(): () => void {
  return configureWorkspaceEditorHost(createReverseEditorHost())
}
