// Regression test for host SceneManager event arbitration. No WebGL/session required.
import {describe,it,expect,vi} from 'vitest'
import {SceneManager} from '../src/viewer/SceneManager'

type SceneProbe = {
  handlePointerDown(e:PointerEvent):boolean
  handleClick(x:number,y:number,ctrlKey?:boolean):void
  editorInput:{pointerDown:(e:PointerEvent)=>boolean,click:(x:number,y:number,additive:boolean)=>boolean}|null
  gizmoAt(x:number,y:number):'x'|'y'|'z'|null
  viewAlong(axis:'x'|'y'|'z'):void
}
function probe(axis:'x'|'y'|'z'|null) {
  const scene=Object.create(SceneManager.prototype) as unknown as SceneProbe
  const pointerDown=vi.fn(()=>false),click=vi.fn(()=>true)
  const gizmoAt=vi.fn(()=>axis),viewAlong=vi.fn()
  scene.editorInput={pointerDown,click}
  scene.gizmoAt=gizmoAt
  scene.viewAlong=viewAlong
  const event=(mods:Record<string,unknown>={})=>({button:0,clientX:302,clientY:555,
    shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,...mods}) as PointerEvent
  return {scene,pointerDown,click,gizmoAt,viewAlong,event}
}
describe('exclusive editor viewport vs orientation gizmo routing',()=>{
  it.each(['x','y','z'] as const)('gives plain left gizmo arrow %s first priority',axis=>{
    const p=probe(axis)
    expect(p.scene.handlePointerDown(p.event())).toBe(true)
    expect(p.viewAlong).toHaveBeenCalledExactlyOnceWith(axis)
    expect(p.pointerDown).not.toHaveBeenCalled()
    expect(p.gizmoAt).toHaveBeenCalledWith(302,555)
  })
  it('lets the editor process non-gizmo mouse-down and subsequent click',()=>{
    const p=probe(null)
    expect(p.scene.handlePointerDown(p.event())).toBe(false)
    expect(p.pointerDown).toHaveBeenCalledOnce()
    p.scene.handleClick(200,250,false)
    expect(p.click).toHaveBeenCalledExactlyOnceWith(200,250,false)
    expect(p.viewAlong).not.toHaveBeenCalled()
  })
  it.each([{button:1},{button:2},{shiftKey:true},{ctrlKey:true},{metaKey:true}])(
    'leaves modified or non-left gestures to the editor: %j',mods=>{
      const p=probe('z')
      expect(p.scene.handlePointerDown(p.event(mods))).toBe(false)
      expect(p.viewAlong).not.toHaveBeenCalled()
      expect(p.pointerDown).toHaveBeenCalledOnce()
    })
})
