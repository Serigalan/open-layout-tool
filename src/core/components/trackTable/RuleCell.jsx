import { useState } from 'react'
import { MAX_SWITCH_CANT, MAX_SWITCH_CANT_EXCEPTION } from '../../utils/rules'
import { useI18n } from '../../locales/i18nContext'
import Modal from '../Modal'
import { SWITCH_CANT_RULE, findingText, reasonOf, ruleGroups, ruleNote } from './rowText'

/**
 * The rule column of one row (Entscheidung 374): what the catalogue found, as
 * two buttons — the errors, red, and the Hinweise, red until each has its
 * reason written and then green with a tick. Each opens a dialog: the errors
 * one by one, the Hinweise each with a field for its reason. A switch route's
 * cant exception (Ausnahme u, LP.KB.05) is written there too, so its cell opens
 * the dialog even where the catalogue found nothing.
 *
 * `onReason(ruleId, text)` writes a reason, `onCantException(text)` the
 * exception.
 */
export default function RuleCell({ index, entry, el, onReason, onCantException }) {
  const { t, fill } = useI18n()
  const [open, setOpen] = useState(null)   // 'errors' | 'hints' | null
  if (!entry || entry.unchecked) {
    return <td className="track-table-rule rule-sev-none" title={t('table_rules_unchecked')}>–</td>
  }
  const { errors, hints, justified } = ruleGroups(entry, el)
  const button = (kind, className, label) => (
    <button type="button" className={`track-table-rule-btn ${className}`}
      onClick={(e) => { e.stopPropagation(); setOpen(kind) }}>{label}</button>
  )
  return (
    <td className="track-table-rule" title={ruleNote(t, entry)}>
      <span className="track-table-rule-cell">
        {errors.length > 0 && button('errors', 'rule-sev-error', fill('table_rules_errors', { n: String(errors.length) }))}
        {hints.length > 0 && button('hints', justified ? 'rule-sev-ok' : 'rule-sev-error',
          `${justified ? '✓ ' : ''}${fill('table_rules_hints', { n: String(hints.length) })}`)}
        {!errors.length && !hints.length && (el.switchBranch
          ? button('hints', 'rule-sev-ok', '✓')
          : <span className="rule-sev-ok">✓</span>)}
      </span>
      {open && (
        <Modal title={fill(open === 'errors' ? 'table_rules_errors_title' : 'table_rules_hints_title', { n: String(index + 1) })}
          className="rule-dialog" onClose={() => setOpen(null)}
          actions={<button type="button" className="modal-btn modal-btn-primary" onClick={() => setOpen(null)}>{t('btn_close')}</button>}>
          {open === 'errors'
            ? <ErrorList errors={errors} />
            : <HintList hints={hints} el={el} onReason={onReason} onCantException={onCantException} />}
        </Modal>
      )}
    </td>
  )
}

/** Where a finding stands: on the element, its ramp, or the joint at its start. */
function placeKey(result) {
  return result.at === 'start' ? 'table_rules_at_start' : 'table_rules_at_element'
}

function ErrorList({ errors }) {
  const { t } = useI18n()
  return (
    <ul className="rule-dialog-list">
      {errors.map((r, k) => (
        <li key={`${r.id}-${k}`} className="rule-dialog-item">
          <span className="rule-sev-error rule-dialog-head">{findingText(t, r)}</span>
          <span className="msg-hint msg-small">{t(placeKey(r))}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The Hinweise, each with its reason: a field per finding, written when it is
 * left. A switch route has the cant exception among them — as the reason for
 * LP.KB.05 where that rule speaks, else as a field of its own, since the
 * exception has to be written before a cant over 100 mm can be typed at all.
 */
function HintList({ hints, el, onReason, onCantException }) {
  const { t, fill } = useI18n()
  const exceptionField = el.switchBranch && !hints.some(h => h.id === SWITCH_CANT_RULE)
  return (
    <ul className="rule-dialog-list">
      {hints.map(h => (
        <li key={h.id} className="rule-dialog-item">
          <span className={`rule-dialog-head ${h.reason ? 'rule-sev-ok' : 'rule-sev-error'}`}>
            {h.reason ? '✓ ' : ''}{findingText(t, h)}
          </span>
          <ReasonField value={reasonOf(el, h.id)}
            label={h.id === SWITCH_CANT_RULE ? t('table_cant_exception') : t('table_rules_reason')}
            onCommit={(text) => (h.id === SWITCH_CANT_RULE ? onCantException(text) : onReason(h.id, text))} />
        </li>
      ))}
      {exceptionField && (
        <li className="rule-dialog-item">
          <span className="rule-dialog-head">{t('table_cant_exception')}</span>
          <span className="msg-hint msg-small">
            {fill('table_cant_exception_hint', { reg: String(MAX_SWITCH_CANT), max: String(MAX_SWITCH_CANT_EXCEPTION) })}
          </span>
          <ReasonField value={reasonOf(el, SWITCH_CANT_RULE)} label={t('table_cant_exception')} onCommit={onCantException} />
        </li>
      )}
      {!hints.length && !exceptionField && <li className="rule-sev-ok">{t('table_rules_ok')}</li>}
    </ul>
  )
}

/** A reason: typed freely, written when the field is left and only where it changed. */
function ReasonField({ value, label, onCommit }) {
  const [draft, setDraft] = useState(value)
  return (
    <textarea className="rule-dialog-reason" rows={2} aria-label={label} placeholder={label}
      value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== value) onCommit(draft.trim()) }} />
  )
}
