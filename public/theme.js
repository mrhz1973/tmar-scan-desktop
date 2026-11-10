// SPDX-License-Identifier: AGPL-3.0-only
// TMAR's first paint matches prefsStore while retaining upstream's external
// script, so the page needs neither inline script permission nor a CSP hash.
var t = 'dark'
try {
  var saved = localStorage.getItem('scanruler.uitheme')
  if (saved === 'light' || saved === 'dark' || saved === 'system') t = saved
} catch (e) {}
var dark = t === 'dark' || (t === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.dataset.theme = dark ? 'dark' : 'light'
