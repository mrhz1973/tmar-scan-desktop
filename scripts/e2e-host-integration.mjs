// SPDX-License-Identifier: AGPL-3.0-only
// Own the local server and synthetic test profiles. This never attaches to an
// existing user session, and only copies test evidence out of the private run.
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = mkdtempSync(join(tmpdir(), 'scanruler-host-integration-'))
const retained = join(root, 'e2e-out', 'ci', 'host-integration')
const checks = [
  'plugins/reverse/scripts/e2e-host-consolidation-20261110.mjs',
  'plugins/reverse/scripts/e2e-surface-history-workspace.mjs',
]
let child
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true
  process.exitCode = 1
  child?.kill('SIGTERM')
})

const server = await createServer({ root, server: {
  host: '127.0.0.1', port: 0, strictPort: false, open: false,
  watch: { ignored: ['**/e2e-out/**'] },
} })
try {
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('The isolated integration server has no local URL.')
  for (const script of checks) {
    if (interrupted) break
    console.log(`Running ${basename(script)} against the owned server ${url}`)
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [join(root, script)], { cwd: root,
        env: { ...process.env, APP_URL: url, SCANRULER_ISOLATED: '1', HOST_QA_OUT: evidence },
        stdio: 'inherit', windowsHide: true,
      })
      child.once('error', reject)
      child.once('close', code => resolve(code ?? 1))
    })
    child = undefined
    if (code !== 0) process.exitCode = 1
  }
} finally {
  await server.close()
  mkdirSync(retained, { recursive: true })
  for (const name of readdirSync(evidence)) {
    cpSync(join(evidence, name), join(retained, name), { recursive: true,
      // Browser profiles are disposable test state, not evidence to publish.
      filter: source => !['owned-browser-profile', 'browser-profile'].includes(basename(source)),
    })
  }
  console.log(`Synthetic integration evidence: ${retained}`)
}
