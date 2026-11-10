// SPDX-License-Identifier: AGPL-3.0-only
// Isolated candidate only: no app proxy, deployment hook, or service management.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { aggregateMetadata, parseArguments } from './metadata.mjs'

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export async function createLauncherServer(options = {}) {
  const [html, javascript] = await Promise.all([
    readFile(new URL('./index.html', import.meta.url)),
    readFile(new URL('./launcher-version.js', import.meta.url)),
  ])
  return createServer(async (request, response) => {
    const send = (status, contentType, content, extra = {}) => {
      response.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(content),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': CSP,
        ...extra,
      })
      response.end(request.method === 'HEAD' ? undefined : content)
    }
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'text/plain; charset=utf-8', 'Method not allowed\n', { Allow: 'GET, HEAD' })
      const url = new URL(request.url, 'http://127.0.0.1')
      if (url.pathname === '/' && url.searchParams.get('version') === 'stable') {
        return send(404, 'text/plain; charset=utf-8', 'Anteprima isolata: la rotta Stable appartiene al server applicativo esistente.\n')
      }
      if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', html)
      if (url.pathname === '/launcher-version.js') return send(200, 'text/javascript; charset=utf-8', javascript)
      if (url.pathname === '/tmar-live-versions.json') {
        return send(200, 'application/json; charset=utf-8', JSON.stringify(await aggregateMetadata(options)) + '\n')
      }
      return send(404, 'text/plain; charset=utf-8', 'Not found\n')
    } catch { return send(503, 'text/plain; charset=utf-8', 'Non disponibile\n') }
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2), true)
    const server = await createLauncherServer(options)
    server.on('error', error => { console.error(error.message); process.exitCode = 1 })
    server.listen(options.port, '127.0.0.1', () => {
      console.log(`Launcher candidato: http://127.0.0.1:${server.address().port}/`)
      console.log('Solo launcher e metadata locali. Ctrl+C termina questa anteprima.')
    })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
