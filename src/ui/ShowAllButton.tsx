// SPDX-License-Identifier: AGPL-3.0-only
// The one eye for a whole list: hides everything while anything is showing,
// shows everything once it is all hidden. Sits in the list's label row beside
// the count.

import { Icon } from './icons'
import { coreText as tmarText, useLanguage as useTmarLanguage } from '../i18n'


export function ShowAllButton({
  anyVisible,
  what,
  testId,
  onSet,
}: {
  anyVisible: boolean
  /** What the list holds, for the tooltip: "elements", "dimensions". */
  what: string
  testId?: string
  onSet: (visible: boolean) => void
}) {
  useTmarLanguage()

  return (
    <button
      className="x eye all"
      data-test={testId}
      title={anyVisible ? tmarText("Hide all {0} in the viewport", [what]) : tmarText("Show all {0}", [what])}
      onClick={() => onSet(!anyVisible)}
    >
      <Icon name={anyVisible ? 'eye' : 'eyeOff'} size={13} />
      {anyVisible ? tmarText("Hide all") : tmarText("Show all")}
    </button>
  )
}
