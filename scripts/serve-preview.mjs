// SPDX-License-Identifier: AGPL-3.0-only
// Serve an already compiled preview on loopback, using only Node built-ins.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 5189)
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !existsSync(resolve(root, 'index.html'))) {
  console.error('Usage: node serve-preview.mjs <compiled-dist-directory> [port 1024–65535]')
  process.exit(1)
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const path = resolve(root, '.' + pathname)
    const inside = relative(root, path)
    if (inside === '..' || inside.startsWith('..' + sep)) { response.writeHead(403); response.end(); return }
    const file = pathname.endsWith('/') ? resolve(path, 'index.html') : path
    if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': statSync(file).size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    if (request.method === 'HEAD') { response.end(); return }
    createReadStream(file).on('error', () => response.destroy()).pipe(response)
  } catch { response.writeHead(400); response.end() }
})
server.on('error', error => { console.error(error.message); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => {
  console.log(`TMAR ScanRuler preview: http://127.0.0.1:${port}/`)
  console.log('Open this address in a separate browser tab. Ctrl+C stops this preview.')
})
