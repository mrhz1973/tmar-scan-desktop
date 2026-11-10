// SPDX-License-Identifier: AGPL-3.0-only
import type { Net } from './brep'
import { SurfaceWorkerRequestError } from './workerClient'

/** Only an explicit select refusal guarantees that the previous worker selection
 * survived. A lost reply or a failed local install must disable the old draft. */
export async function changeSurfaceFace(options: {
  select: () => Promise<Net>
  current: () => boolean
  install: (net: Net) => void
  invalidate: () => void
}): Promise<void> {
  let accepted = false
  try {
    const net = await options.select()
    accepted = true
    if (options.current()) options.install(net)
  } catch (error) {
    if (options.current() && (accepted || !(error instanceof SurfaceWorkerRequestError))) options.invalidate()
    throw error
  }
}
