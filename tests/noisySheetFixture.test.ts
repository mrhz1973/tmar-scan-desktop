// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// @ts-expect-error The shared Node-only test fixture is an untyped .mjs module.
import { noisySheet } from '../scripts/fixtures/noisy-sheet.mjs'

type Fixture = { bytes: Buffer; positions: number[]; indices: number[] }

function verifyFixture(n: number, step: number): void {
  const { bytes, positions, indices } = noisySheet(n, step) as Fixture
  expect(positions.length).toBe((n + 1) ** 2 * 3)
  expect(indices.length).toBe(n * n * 6)
  const end = bytes.indexOf('end_header\n') + 'end_header\n'.length
  expect(end).toBeGreaterThan('end_header\n'.length)
  const header = bytes.subarray(0, end).toString('ascii')
  expect(header).toContain('format binary_little_endian 1.0')
  expect(header).toContain(`element vertex ${(n + 1) ** 2}\n`)
  expect(header).toContain(`element face ${n * n * 2}\n`)
  expect(bytes.length).toBe(end + positions.length * 4 + indices.length / 3 * 13)
  let offset = end
  for (const value of positions) {
    expect(Number.isFinite(value)).toBe(true)
    expect(bytes.readFloatLE(offset)).toBe(Math.fround(value))
    offset += 4
  }
  for (let t = 0; t < indices.length; t += 3) {
    expect(bytes[offset++]).toBe(3)
    for (let k = 0; k < 3; k++) {
      const index = bytes.readUInt32LE(offset)
      expect(index).toBe(indices[t + k])
      expect(index).toBeLessThan((n + 1) ** 2)
      offset += 4
    }
  }
  expect(offset).toBe(bytes.length)
  expect(positions[0]).toBe(-n * step / 2)
  expect(positions[1]).toBe(-n * step / 2)
  expect(positions.at(-3)).toBe(n * step / 2)
  expect(positions.at(-2)).toBe(n * step / 2)
}

describe('shared noisy-sheet documentation fixture', () => {
  it('preserves the default indexed PLY topology and binary coordinates', () => {
    verifyFixture(48, 0.5)
  })

  it('keeps custom resolution/spacing deterministic without shared mutable arrays', () => {
    verifyFixture(4, 0.75)
    const first = noisySheet(4, 0.75) as Fixture
    const second = noisySheet(4, 0.75) as Fixture
    expect(first.bytes.equals(second.bytes)).toBe(true)
    expect(first.positions).toEqual(second.positions)
    expect(first.indices).toEqual(second.indices)
    first.bytes[0] = 0
    first.positions[0] = 999
    first.indices[0] = 999
    expect(second.bytes[0]).toBe('p'.charCodeAt(0))
    expect(second.positions[0]).toBe(-1.5)
    expect(second.indices[0]).toBe(0)
  })

  it('loads and generates data with no plugins directory or application dependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tmar-shared-fixture-'))
    try {
      const target = join(dir, 'noisy-sheet.mjs')
      copyFileSync(new URL('../scripts/fixtures/noisy-sheet.mjs', import.meta.url), target)
      const program = `import { noisySheet } from ${JSON.stringify(pathToFileURL(target).href)};
        const f = noisySheet(2, 1);
        console.log(JSON.stringify([f.positions.length / 3, f.indices.length / 3, Buffer.isBuffer(f.bytes)]));`
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
        cwd: dir, encoding: 'utf8', timeout: 5000,
      })
      expect(JSON.parse(output)).toEqual([9, 8, true])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
