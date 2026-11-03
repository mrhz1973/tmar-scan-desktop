// SPDX-License-Identifier: AGPL-3.0-only
import { IconFrame } from '../../src/ui/icons'

/** Four square patches and their nine poles, using the app's 24-unit icon grammar. */
export function EditSurfaceIcon() {
  return <IconFrame>
    <path className="i-f" d="M4 4h16v16H4Z" />
    <path className="i-a i-th" d="M12 4v16M4 12h16" />
    {[4, 12, 20].flatMap(y => [4, 12, 20].map(x =>
      <circle key={`${x}-${y}`} className="i-adt" cx={x} cy={y} r={x === 12 && y === 12 ? 1.65 : 1.25} />,
    ))}
  </IconFrame>
}
