// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import * as THREE from 'three'
import { useStore } from '../../src/state/store'
import { useMark } from '../../src/state/markStore'
import { useShell } from '../../src/state/shellStore'
import { useCommandActivity } from '../../src/commands/activity'
import type { SceneManager } from '../../src/viewer/SceneManager'
import { useMeshTools } from '../mesh-tools/state/meshStore'
import { meshSceneOf } from '../mesh-tools/viewer/meshScene'
import { NoteList } from '../reverse/ui/NoteList'
import { useNotes } from '../reverse/state/noteStore'
import { armNote } from '../tmar-quick-notes/quickAccess'
import { ZebraPanel } from '../tmar-zebra/ZebraPanel'
import { enableZebra, useZebraUi, ZebraIcon } from '../tmar-zebra/ZebraQuickButton'
import { inspectionBlockNow, meshNoteBlockNow } from './meshNotes'
import { meshTargetLabel } from './policy'
import { pluginText as tmarText, useLanguage as useTmarLanguage } from '../../src/i18n'


/** Borrow the mesh actually on screen, never the hidden original behind an
 * edited/reduced copy. The existing Zebra layer owns only its own material. */
export function inspectionMesh(scene: SceneManager): THREE.Mesh | null {
  const geometry = meshSceneOf(scene).reducedGeometry()
  const reduced = geometry && scene.layerHost().partGroup.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry === geometry && o.visible)
  return reduced || scene.scanDisplay()?.mesh || null
}
function useInspectionState() {
  const mesh = useMeshTools()
  useStore(s => s.fileName); useStore(s => s.busy)
  useMark(s => s.gesture); useCommandActivity(s => s.running)
  return { mesh, blocked: inspectionBlockNow(), noteBlocked: meshNoteBlockNow() }
}
export function toggleMeshZebra(on: boolean): void {
  const blocked = inspectionBlockNow()
  if (on && blocked) { useStore.getState().setStatus(blocked); return }
  if (on) useZebraUi.getState().setTarget('scan')
  enableZebra(on)
}
export function MeshZebraPanel() {
  const { mesh, blocked, noteBlocked } = useInspectionState()
  useEffect(() => { if (blocked) enableZebra(false) }, [blocked])
  return <ZebraPanel inspection={{ source: inspectionMesh, label: meshTargetLabel(mesh), blocked, noteBlocked,
    addNote: armNote, toggle: toggleMeshZebra,
    hint: 'Zebra is a visual reflection overlay, not the numerical Accuracy/Deviation map. Switching it off restores the current colors and leaves all measurements and edits unchanged.' }} />
}
export function MeshZebraButton() {
  useTmarLanguage()

  const workspace = useShell(s => s.workspace), enabled = useZebraUi(s => s.enabled)
  const { blocked } = useInspectionState()
  if (workspace !== 'mesh') return null
  return <div className="keys"><button data-test="zebra-quick-toggle" aria-pressed={enabled}
    className={enabled ? 'on' : undefined} disabled={!!blocked && !enabled}
    title={tmarText(blocked) ?? (tmarText("Inspect the displayed mesh with Zebra; this does not measure deviation"))}
    onClick={() => { toggleMeshZebra(!enabled); if (!enabled) requestAnimationFrame(() => document.querySelector('[data-test=tmar-zebra]')?.scrollIntoView({block:'nearest'})) }}>
    <ZebraIcon/>{tmarText("Zebra")}</button></div>
}
export function MeshNotesPanel() {
  useTmarLanguage()

  const { noteBlocked } = useInspectionState()
  const placing = useNotes(s => s.placing)
  useEffect(() => {
    if (placing && noteBlocked) { useNotes.getState().setPlacing(false); useStore.getState().setStatus(noteBlocked) }
  }, [placing, noteBlocked])
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !useNotes.getState().placing) return
      useNotes.getState().setPlacing(false); e.preventDefault(); e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true); useNotes.getState().setPlacing(false) }
  }, [])
  return <section data-test="mesh-review-notes" aria-label={tmarText("Mesh Tools notes")}>
    <NoteList placementBlocked={noteBlocked}/>
    <p className="hint" data-test="mesh-note-help">{tmarText(noteBlocked) ?? (tmarText("Local notes on the scan in use. The same notes, selection, focus and saved anchors are shared with Reverse engineer and Surface Deviation. No agent connection is required."))}</p>
  </section>
}
