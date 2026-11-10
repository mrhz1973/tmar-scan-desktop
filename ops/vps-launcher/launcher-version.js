// SPDX-License-Identifier: AGPL-3.0-only
// Only the chooser's readouts change; an open ScanRuler session is never reloaded.
(() => {
  'use strict'
  const unavailable = 'Non disponibile'
  const fields = ['base', 'tmar', 'revision', 'date']
  const dateFormat = new Intl.DateTimeFormat('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
  })
  let inFlight = false

  function render(channel, metadata) {
    const values = Object.fromEntries(fields.map(field => [field, unavailable]))
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      if (typeof metadata.cnckitchen_version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(metadata.cnckitchen_version)) {
        values.base = `v${metadata.cnckitchen_version}`
      }
      if ([null, 'preview', 'stable'].includes(metadata.tmar_channel)) {
        if (metadata.tmar_number === null) values.tmar = 'TMAR Web — non numerata'
        else if (Number.isSafeInteger(metadata.tmar_number) && metadata.tmar_number > 0) {
          const label = metadata.tmar_channel === 'preview' ? ' — Anteprima' : metadata.tmar_channel === 'stable' ? ' — Stabile' : ''
          values.tmar = `TMAR Versione ${metadata.tmar_number}${label}`
        }
      }
      if (typeof metadata.revision === 'string' && /^[0-9a-f]{40}$/i.test(metadata.revision)) values.revision = metadata.revision.slice(0, 7)
      const date = metadata.built_at_utc
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date) && Number.isFinite(Date.parse(date))) {
        const parsed = new Date(date)
        if (parsed.toISOString() === (date.includes('.') ? date : date.replace('Z', '.000Z'))) values.date = dateFormat.format(parsed)
      }
    }
    for (const field of fields) {
      const element = document.getElementById(`${channel}-${field}`)
      if (element) element.textContent = values[field]
    }
  }

  async function refresh() {
    if (inFlight) return
    inFlight = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('/tmar-live-versions.json', {
        cache: 'no-store', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Metadata unavailable')
      const aggregate = await response.json()
      if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) throw new Error('Invalid metadata')
      render('stable', aggregate.stable)
      render('dev', aggregate.dev)
    } catch {
      render('stable', null)
      render('dev', null)
    } finally {
      clearTimeout(timeout)
      inFlight = false
    }
  }

  void refresh()
  setInterval(() => { void refresh() }, 120000)
})()
