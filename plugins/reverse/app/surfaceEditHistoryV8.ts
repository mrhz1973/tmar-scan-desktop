// SPDX-License-Identifier: AGPL-3.0-only
// Host-owned experimental v8 boundary; NEVER trust an envelope in place of OCCT replay.
// Independent of plugins/tmar-edit-surface/** so plugin ownership stays with its author.
const HEX = /^[a-f0-9]{64}$/
const hash = (x: unknown): x is string => typeof x === 'string' && HEX.test(x)
const safeIndex = (x: unknown): x is number =>
  Number.isSafeInteger(x) && !Object.is(x, -0) && (x as number) >= 0
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && keys.every(key => {
    const desc = Object.getOwnPropertyDescriptor(value, key)
    return !!desc && 'value' in desc && desc.enumerable
  })
}
const dense = (value: unknown, limit: number): value is unknown[] =>
  Array.isArray(value) && value.length <= limit && Reflect.ownKeys(value).length === value.length + 1 &&
  Array.from({length:value.length},(_,i) => {
    const desc = Object.getOwnPropertyDescriptor(value,String(i))
    return !!desc && 'value' in desc && desc.enumerable
  }).every(Boolean)
const point3 = (p: unknown): p is number[] =>
  dense(p, 3) && p.length === 3 && p.every(x => typeof x === 'number' && Number.isFinite(x))
const validItem = (v: unknown): v is Record<string, unknown> =>
  exact(v, ['index','point']) && safeIndex(v.index) && point3(v.point)

/** Parsing is structural only. A fresh, independent OCCT replay is mandatory afterward. */
export function assertHostAdaptiveLockedRecipeV8(value: unknown): void {
  const fail = (): never => { throw new Error('Contratto host sperimentale v8 non valido.') }
  if (!exact(value, ['schema','version','engine','units','coordinateFrame','source','faceIndex',
    'preparation','baseNetSha256','continuity','edits','lockedPoles','boundaryMode',
    'refinements','trimPolicy','lockedValues'])) return fail()
  if (value.schema !== 'tmar.surface-edit' || value.version !== 8 ||
      value.engine !== 'occt-wasm-5.7.1/brep-v3' || value.units !== 'mm' ||
      value.coordinateFrame !== 'imported-step' || value.preparation !== 'plane-to-bicubic' ||
      value.boundaryMode !== 'locked' || value.trimPolicy !== 'circular-fine-v1' ||
      !['G0','G1'].includes(value.continuity as string) || !hash(value.baseNetSha256) ||
      !exact(value.source, ['bodyId','brepSha256','faceCount','solidCount'])) return fail()
  const source = value.source
  if (typeof source.bodyId !== 'string' || !source.bodyId.trim() || source.bodyId.length > 1024 ||
      !hash(source.brepSha256) || !safeIndex(source.faceCount) || source.faceCount === 0 ||
      !safeIndex(source.solidCount) || source.solidCount === 0 ||
      !safeIndex(value.faceIndex) || (value.faceIndex as number) >= (source.faceCount as number)) return fail()
  if (!dense(value.edits, 40000) || !dense(value.lockedPoles, 1600) ||
      !dense(value.lockedValues, 1600) || !dense(value.refinements, 4000)) return fail()
  const edits = value.edits, locks = value.lockedPoles, positions = value.lockedValues, ops = value.refinements
  if (edits.some(x => !validItem(x)) ||
      new Set(edits.map(x => (x as {index:number}).index)).size !== edits.length ||
      locks.some(x => !safeIndex(x)) || new Set(locks).size !== locks.length ||
      positions.some(x => !validItem(x)) ||
      new Set(positions.map(x => (x as {index:number}).index)).size !== positions.length ||
      positions.length !== locks.length ||
      positions.some(x => !locks.includes((x as {index:number}).index)) ||
      ops.some(x => !exact(x,['axis','value','count']) ||
        !['U','V'].includes(x.axis as string) || typeof x.value !== 'number' ||
        !Number.isFinite(x.value) || !Number.isSafeInteger(x.count) ||
        (x.count as number) < 1 || (x.count as number) > 16)) return fail()
}
