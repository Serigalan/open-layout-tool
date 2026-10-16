import { useState } from 'react'
import { ruleById, severityLabelKey } from '../../../utils/rules'
import { connectRemedies } from '../../../utils/commands'
import { useI18n } from '../../../locales/i18nContext'

/**
 * The suggestions of "an Gleis anschließen" where the rules reject the
 * refitted element (Entscheidung 314; utils/commands/connectRemedies) — as
 * "Zwei Gleise zusammenfügen" offers them: a button that asks for them, then
 * one line each — what it changes, what is still found — with a button that
 * takes it over (`onAdopt(remedy)`). The dialog keys it by the solution it
 * shows, so another solution asks afresh.
 */
export default function ConnectRemedies({ anchor, current, outcome, outcomeFor, onAdopt }) {
  const { t, fill } = useI18n()
  const [state, setState] = useState(null)   // null | { busy } | { list }

  const ask = () => {
    setState({ busy: true })
    // Let the busy line show before the search holds the page.
    setTimeout(() => setState({ list: connectRemedies({ anchor, current, outcome, outcomeFor }) }), 30)
  }
  if (!state) {
    return (
      <button type="button" className="panel-btn secondary splice-remedies-ask" onClick={ask}>
        {t('splice_remedies_show')}
      </button>
    )
  }
  if (state.busy) return <p className="msg-hint">{t('splice_remedies_busy')}</p>
  if (!state.list.length) return <p className="msg-hint">{t('connect_remedies_none')}</p>

  const what = (r) => {
    if (r.kind === 'speed') return fill('connect_remedy_speed', { v: String(r.speed) })
    const text = fill('connect_remedy_transition', { l: r.length.toFixed(1) })
    return r.speed ? `${text} ${fill('connect_remedy_and_speed', { v: String(r.speed) })}` : text
  }
  const after = (r) => {
    if (!r.remaining.length) return t('splice_remedy_clean')
    const worst = new Map()
    for (const f of r.remaining) if (!worst.has(f.id) || f.severity === 'error') worst.set(f.id, f.severity)
    const items = [...worst].map(([id, sev]) => `${t(severityLabelKey(sev))} ${id} ${ruleById(id)?.title ?? ''}`.trim())
    return `${t('splice_remedy_after')} ${items.join(' · ')}`
  }
  return (
    <div className="splice-remedies">
      <p className="splice-remedies-title">{t('connect_remedies_title')}</p>
      <ul>
        {state.list.map(r => (
          <li key={r.kind}>
            <span className="splice-remedy-text">
              {what(r)}
              <span className="splice-remedy-after">{after(r)}</span>
            </span>
            <button type="button" className="panel-btn secondary" onClick={() => onAdopt(r)}>{t('splice_remedy_adopt')}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
