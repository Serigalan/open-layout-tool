import { ruleById, severityLabelKey } from '../../../utils/rules/regelkatalog'
import { useI18n } from '../../../locales/i18nContext'

/**
 * The ways out of a curvature jump the catalogue rejects (utils/splice
 * spliceRemedies): first a button that asks for them, then one line each —
 * what it changes, what is still found on it — with a button that takes it
 * over into the dialog (`onAdopt`). `state` is null before asking, { busy }
 * while they are searched, else { list }. `picks` are the two picks and
 * `names` their tracks' names, for a proposal that lowers their speed.
 */
export default function SpliceRemedies({ state, picks, names, onAsk, onAdopt }) {
  const { t, fill } = useI18n()
  if (!state) {
    return (
      <button type="button" className="panel-btn secondary splice-remedies-ask" onClick={onAsk}>
        {t('splice_remedies_show')}
      </button>
    )
  }
  if (state.busy) return <p className="msg-hint">{t('splice_remedies_busy')}</p>
  if (!state.list.length) return <p className="msg-hint">{t('splice_remedies_none')}</p>

  const what = (r) => {
    if (r.kind === 'radius') return fill('splice_remedy_radius', { r: String(r.radius) })
    if (r.kind === 'transitions') return t('splice_remedy_transitions')
    const lowered = names.filter((_, k) => (picks[k].speed ?? 0) > r.speed)
    const v = String(r.speed)
    if (lowered.length === 2) return fill('splice_remedy_speed_both', { v })
    if (lowered.length === 1) return fill('splice_remedy_speed_one', { v, track: lowered[0] })
    return fill('splice_remedy_speed_new', { v })
  }
  // What is still found, one entry per rule and the worst of it.
  const after = (r) => {
    if (!r.remaining.length) return t('splice_remedy_clean')
    const worst = new Map()
    for (const f of r.remaining) if (!worst.has(f.id) || f.severity === 'error') worst.set(f.id, f.severity)
    const items = [...worst].sort(([, a], [, b]) => (a === 'error' ? -1 : 0) - (b === 'error' ? -1 : 0))
      .map(([id, sev]) => `${t(severityLabelKey(sev))} ${id} ${ruleById(id)?.title ?? ''}`.trim())
    return `${t('splice_remedy_after')} ${items.join(' · ')}`
  }

  return (
    <div className="splice-remedies">
      <p className="splice-remedies-title">{t('splice_remedies_title')}</p>
      <ul>
        {state.list.map(r => (
          <li key={r.kind}>
            <span className="splice-remedy-text">
              {what(r)}
              <span className={`splice-remedy-after${r.worst === 'error' ? ' error' : ''}`}>{after(r)}</span>
            </span>
            <button type="button" className="panel-btn secondary" onClick={() => onAdopt(r)}>{t('splice_remedy_adopt')}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
