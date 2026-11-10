// SPDX-License-Identifier: AGPL-3.0-only
// The model's parameters, as a folded section at the head of the panel: a
// row a parameter — its name, its kind, the expression it is given and the
// value that comes to — and a key to add one. A row refused says why under
// it and keeps what was typed; a parameter changed moves every number that
// reads it and the part rebuilds (see core/parameters.ts and the store).
// A length's value is shown in the display units, and a figure typed for
// it is taken in them; the expression kept reads in millimetres wherever
// it is evaluated (reLength.ts says how).

import { useEffect, useRef, useState } from 'react'
import { formatValue } from '../core/expression'
import { PARAMETER_KINDS, type Parameter } from '../core/parameters'
import { useReverse } from '../state/reStore'
import { useUnits } from '../../../src/app/useUnits'
import { InfoDot } from '../../../src/ui/InfoDot'
import { PARAMETER_NAMES_LIST } from './ExprInput'
import { parameterExpression, parameterText } from './reLength'
import { reverseText as tmarText, useLanguage as useTmarLanguage } from '../../../src/i18n'


/** A text field committed on blur or Enter, Escape putting the old text
 *  back; keyed on the text it was given, so a store change shows through. */
function TextCommit({ shown, testId, placeholder, label, mono, onCommit }: { shown: string; testId: string; placeholder?: string; label: string; mono?: boolean; onCommit: (text: string) => void }) {
  useTmarLanguage()

  return (
    <input
      type="text"
      key={shown}
      defaultValue={shown}
      placeholder={tmarText(placeholder)}
      aria-label={tmarText(label)}
      title={tmarText(label)}
      spellCheck={false}
      autoComplete="off"
      className={mono ? 'mono' : undefined}
      list={mono ? PARAMETER_NAMES_LIST : undefined}
      data-test={testId}
      // Handed on as it stands, changed or not: the store makes nothing of
      // the same text again, and a refusal under the row clears once the
      // field is left with text that will do.
      onBlur={(e) => onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.value = shown
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function ParameterRow({ p, focus }: { p: Parameter; focus: boolean }) {
  useTmarLanguage()

  // Pointed at, or a field of it being typed in: what it drives is lit in
  // the feature list and on the part.
  const lit = (on: boolean) => {
    const s = useReverse.getState()
    if (on) s.setParameterLit(p.id)
    else if (s.parameterLit === p.id) s.setParameterLit(null)
  }
  const reading = useReverse((s) => s.parameterTable.readings.find((r) => r.id === p.id))
  const [refusal, setRefusal] = useState<string | null>(null)
  const [noting, setNoting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focus) {
      const input = nameRef.current?.querySelector<HTMLInputElement>('input[data-test="parameter-name"]')
      input?.focus()
      input?.select()
    }
  }, [focus])
  const units = useUnits()
  const re = useReverse
  const tell = (problem: string | null) => setRefusal(problem)
  const value = reading?.value
  const problem = refusal ?? reading?.error ?? null
  // The expression as the row shows it; left as shown, the one kept stays
  // as it was — a figure shown rounded in inches is not taken back.
  const shownExpression = parameterText(p.expression, p.kind, units)
  const takeExpression = (typed: string) => (typed === shownExpression.trim() ? p.expression : parameterExpression(typed, p.kind, units))
  return (
    <div
      className={'kv parameter' + (problem ? ' bad' : '') + (p.pinned ? ' pinned' : '')}
      data-test="parameter-row"
      data-param={p.id}
      ref={nameRef}
      onPointerEnter={() => lit(true)}
      onPointerLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) lit(false)
      }}
      onFocus={() => lit(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) lit(false)
      }}
    >
      <button
        className="x star"
        tabIndex={-1}
        data-test="parameter-pin"
        aria-pressed={Boolean(p.pinned)}
        title={p.pinned ? tmarText("Important — listed first. Click to take the mark off") : tmarText("Mark as important: listed first, with a star — a dimension to iterate on")}
        onClick={() => tell(re.getState().setParameter(p.id, { pinned: !p.pinned }))}
      >
        {p.pinned ? '★' : '☆'}
      </button>
      <TextCommit shown={p.name} testId="parameter-name" label={tmarText("The parameter's name, as expressions use it")} mono onCommit={(name) => tell(re.getState().setParameter(p.id, { name }))} />
      <select data-test="parameter-kind" aria-label={tmarText("Kind")} title={tmarText("What the parameter is: a length in {0}, an angle in degrees, a whole number, or a plain number", [units === 'in' ? tmarText("inches") : tmarText("millimetres")])} value={p.kind} onChange={(e) => tell(re.getState().setParameter(p.id, { kind: e.target.value as Parameter['kind'] }))}>
        {PARAMETER_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {tmarText(k.label)}
          </option>
        ))}
      </select>
      <b className="value" data-test="parameter-value" title={problem ?? (tmarText(undefined))}>
        {value === null || value === undefined ? '—' : formatValue(value, p.kind, units)}
      </b>
      <button className="x note" tabIndex={-1} title={p.comment ? tmarText("Note: {0}", [p.comment]) : tmarText("Add a note on this parameter")} aria-pressed={noting} onClick={() => setNoting((n) => !n)}>
        ✎
      </button>
      <button
        className="x"
        tabIndex={-1}
        title={tmarText("Remove the parameter — refused while anything reads it")}
        data-test="parameter-remove"
        onClick={() => tell(re.getState().removeParameter(p.id))}
      >{tmarText("×")}</button>
      <TextCommit shown={shownExpression} testId="parameter-expression" label={tmarText("The expression the parameter is given — a number, or arithmetic over numbers and other parameters")} mono onCommit={(typed) => tell(re.getState().setParameter(p.id, { expression: takeExpression(typed) }))} />
      {noting && (
        <div className="note-row">
          <TextCommit shown={p.comment ?? ''} testId="parameter-comment" placeholder={tmarText("A note: what the parameter is for")} label={tmarText("A note on the parameter")} onCommit={(comment) => tell(re.getState().setParameter(p.id, { comment }))} />
        </div>
      )}
      {problem && (
        <p className="hint warn rowerror" data-test="parameter-error">
          {tmarText(problem)}
        </p>
      )}
    </div>
  )
}

export function ParameterList() {
  useTmarLanguage()

  const all = useReverse((s) => s.parameters)
  // The ones marked important first, each group in the order made.
  const parameters = [...all.filter((p) => p.pinned), ...all.filter((p) => !p.pinned)]
  // The list folded or gone under the pointer lets its lit row go.
  useEffect(() => () => useReverse.getState().setParameterLit(null), [])
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState<number | null>(null)
  const add = () => {
    const id = useReverse.getState().addParameter()
    setOpen(true)
    setFresh(id)
  }
  return (
    <div className="group parameters" data-test="parameters">
      <div className="sec-head">
        <button className="fold" data-test="parameters-fold" aria-expanded={open} title={open ? tmarText("Fold the parameters away") : tmarText("Show the parameters")} onClick={() => setOpen((o) => !o)}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>{tmarText(" Parameters")}</button>
        <InfoDot title={tmarText("Parameters")}>
          <p>{tmarText("A parameter is a named number — a length, an angle, a whole number or a plain number — given as an expression: ")}<code>25</code>, <code>25.4/12</code>,{' '}
            <code>{tmarText("width/2 + 1")}</code>{tmarText(". Every number field in the workspace takes an expression too, and a parameter by name: an extrude ")}<code>{tmarText("height + 5")}</code>{tmarText(" deep, a sketch's width ")}<code>{tmarText("width")}</code>{tmarText(". Change the parameter and every number that reads it follows, and the part is built again.")}</p>
          <p>{tmarText("Numbers add and multiply as in a calculator, with ")}<code>{tmarText("sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round pow")}</code>, <code>{tmarText("pi")}</code>{tmarText(" and")}{' '}
            <code>{tmarText("e")}</code>{tmarText("; angles are in degrees. A number may carry a unit — ")}<code>{tmarText("1 in")}</code>, <code>{tmarText("2 cm")}</code>, <code>{tmarText("30 deg")}</code>{tmarText(" — and one without takes the field's. Kinds are kept apart: a length and an angle cannot be added, and a length times a length is an area no field wants.")}</p>
          <p>{tmarText("Pointing at a parameter, or typing in it, lights the features it drives in the list and their faces on the part. The ☆ marks one as important: it is listed first, and the agent is told so.")}</p>
          <p>{tmarText("A plain number typed over a field that read a parameter lets the parameter go; so does dragging the field's grip. Renaming a parameter renames it in every expression; one that something reads cannot be removed.")}</p>
        </InfoDot>
        <b data-test="parameter-count">{parameters.length}</b>
        <button data-test="parameter-add" title={tmarText("Add a parameter")} onClick={add}>{tmarText("+ Add")}</button>
      </div>
      <datalist id={PARAMETER_NAMES_LIST}>
        {parameters.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      {open && parameters.length === 0 && <p className="hint">{tmarText("No parameters yet. Add one, name it, and use the name in any number field.")}</p>}
      {open &&
        parameters.map((p) => (
          <ParameterRow key={p.id} p={p} focus={p.id === fresh} />
        ))}
    </div>
  )
}
