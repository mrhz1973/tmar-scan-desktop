// SPDX-License-Identifier: AGPL-3.0-only
// Read release metadata; never stamp a build or change a current symlink.
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_BYTES = 64 * 1024
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function parseMetadata(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return null
  let value
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.revision !== 'string' || !/^[0-9a-f]{40}$/i.test(value.revision)) return null
  if (typeof value.cnckitchen_version !== 'string' || !VERSION.test(value.cnckitchen_version)) return null
  if (value.tmar_number !== null && (!Number.isSafeInteger(value.tmar_number) || value.tmar_number < 1)) return null
  if (![null, 'preview', 'stable'].includes(value.tmar_channel)) return null
  const date = value.built_at_utc
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)) return null
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== (date.includes('.') ? date : date.replace('Z', '.000Z'))) return null
  // Expose only the release contract, never arbitrary contents or local paths.
  return {
    revision: value.revision,
    built_at_utc: date,
    cnckitchen_version: value.cnckitchen_version,
    tmar_number: value.tmar_number,
    tmar_channel: value.tmar_channel,
    ...(typeof value.channel === 'string' && value.channel.length <= 256 ? { channel: value.channel } : {}),
    ...(typeof value.source_branch === 'string' && value.source_branch.length <= 256 ? { source_branch: value.source_branch } : {}),
  }
}

export async function readMetadata(path) {
  if (!path) return null
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    return parseMetadata(await readFile(path, { encoding: 'utf8', signal: AbortSignal.timeout(1500) }))
  } catch { return null }
}

export async function aggregateMetadata({ stablePath, devPath } = {}) {
  // Resolve both current paths on each request so an atomic promotion is visible.
  const [stable, dev] = await Promise.all([readMetadata(stablePath), readMetadata(devPath)])
  return { stable, dev }
}

export function parseArguments(args, allowPort = false) {
  const options = { stablePath: undefined, devPath: undefined, port: 0 }
  const seen = new Set()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1]
    if (!value || value.startsWith('--') || seen.has(flag)) throw new Error(`Missing or repeated option: ${flag}`)
    seen.add(flag)
    if (flag === '--stable-metadata') options.stablePath = resolve(value)
    else if (flag === '--dev-metadata') options.devPath = resolve(value)
    else if (flag === '--port' && allowPort && /^\d+$/.test(value) && Number(value) <= 65535) options.port = Number(value)
    else throw new Error(`Unknown or invalid option: ${flag}`)
  }
  return options
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await aggregateMetadata(parseArguments(process.argv.slice(2)))
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
