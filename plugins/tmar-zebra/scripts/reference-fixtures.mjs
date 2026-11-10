// SPDX-License-Identifier: AGPL-3.0-only
// Small public-safe analytical fixtures for the same-shape QS comparison.
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const result = await build({ entryPoints: [resolve(root, 'src/core/exportStep.ts')], bundle: true, write: false, platform: 'node', format: 'esm' })
const { buildStepFile } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const output = resolve(root, 'e2e-out/zebra-reference')
mkdirSync(output, { recursive: true })
for (const [name, fit] of [
  ['sphere', { kind: 'sphere', center: [0, 0, 0], radius: 20 }],
  ['torus', { kind: 'torus', center: [0, 0, 0], axis: [0, 0, 1], majorRadius: 20, minorRadius: 7 }],
]) {
  const path = resolve(output, `${name}.step`)
  writeFileSync(path, buildStepFile([{ name, fit }], name, '2026-11-02T00:00:00Z'))
  console.log(path)
}
