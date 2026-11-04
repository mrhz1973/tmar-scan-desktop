// SPDX-License-Identifier: AGPL-3.0-only
export interface TmarVersion { number: number | null; channel: 'preview' | 'stable' }
export const TMAR_VERSION: Readonly<TmarVersion> = typeof __TMAR_VERSION__ === 'undefined'
  ? { number: null, channel: 'preview' }
  : __TMAR_VERSION__
export const tmarVersionLabel = (version: TmarVersion): string =>
  version.number !== null && Number.isSafeInteger(version.number) && version.number > 0
    ? `Versione ${version.number}` : 'Versione non assegnata'
export const tmarChannelLabel = (version: TmarVersion): string =>
  version.channel === 'stable' ? 'Stabile' : 'Anteprima'
