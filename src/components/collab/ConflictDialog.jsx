import { useEffect, useMemo, useState } from 'react'
import { resolve, validationConflicts } from '../../utils/merge'
import { clearFeatures, drawable, findObject, objectFeatures, showFeaturesSoon, zoomToFeatures, COMPARE_COLORS } from '../../utils/compareLayer'
import { conflictText, entryText, findingText, valueText } from './mergeText'
import './collab.css'
import { useI18n } from '../../locales/i18nContext'
import { useMap } from '../../map/MapContext'

const LAYER = 'conflict'

/**
 * The conflict dialog (AP 10.3): every conflict of a merge with the choice of
 * a side, both states of the object on the map, the validation's errors in the
 * same list — and "apply" only once everything is decided and the result
 * holds together. Without conflicts it is the list of what is taken over from
 * the other side, to confirm.
 *
 * `result` is what mergeProject returned; `onApply` gets the decided record
 * (dehydrated). The validation conflicts are worked out anew after every
 * choice: taking a side can solve one and bring up another.
 */
export default function ConflictDialog({ mapVersion = 0, result, title, mineLabel, theirsLabel, onCancel, onApply, busy = false }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const fieldConflicts = useMemo(() => result.conflicts.filter(c => c.kind !== 'validation'), [result])
  const [choices, setChoices] = useState({})
  const [selected, setSelected] = useState(null)
  const [seen, setSeen] = useState(() => new Map(result.conflicts.filter(c => c.kind === 'validation').map(c => [c.id, c])))

  const live = useMemo(() => {
    const record = resolve(result, choices)
    return { record, ...validationConflicts(record, result.context) }
  }, [result, choices])

  // A validation conflict stays listed once it came up, solved or not, so
  // the choice that solved it can still be seen and changed.
  useEffect(() => {
    setSeen(prev => {
      const missing = live.conflicts.filter(c => !prev.has(c.id))
      if (!missing.length) return prev
      const next = new Map(prev)
      missing.forEach(c => next.set(c.id, c))
      return next
    })
  }, [live])

  const failing = new Set(live.conflicts.map(c => c.id))
  const currentValidation = new Map(live.conflicts.map(c => [c.id, c]))
  const validationRows = [...seen.values()].map(c => currentValidation.get(c.id) ?? c)
  const open = fieldConflicts.filter(c => !choices[c.id]).length + live.conflicts.length
  const labels = { mineLabel, theirsLabel }

  const sides = useMemo(() => ({
    mine: drawable(result.context.mine),
    theirs: drawable(result.context.theirs),
  }), [result])

  useEffect(() => {
    const m = map?.current
    if (!m) return undefined
    const c = [...fieldConflicts, ...validationRows].find(x => x.id === selected)
    if (!c || c.collection === 'project') { try { clearFeatures(m, LAYER) } catch { /* map gone */ } return undefined }
    const features = ['mine', 'theirs'].flatMap(side => objectFeatures(
      sides[side], c.collection, findObject(sides[side], c.collection, c.objectId), side))
    const stop = showFeaturesSoon(m, LAYER, features)
    zoomToFeatures(m, features, { covered: 0.62 })
    return stop
    // validationRows is derived from `seen` and `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapVersion, selected, sides, fieldConflicts, seen, live])
  useEffect(() => () => { try { clearFeatures(map?.current, LAYER) } catch { /* map gone */ } }, [map])

  const choose = (id, side) => setChoices(prev => ({ ...prev, [id]: side }))

  const row = (c, { validation = false } = {}) => (
    <li key={c.id} className={`collab-conflict ${selected === c.id ? 'selected' : ''} ${validation && !failing.has(c.id) ? 'solved' : ''}`}>
      <button type="button" className="collab-conflict-head" onClick={() => setSelected(c.id)}>
        <span className="collab-conflict-text">{conflictText(t, c, labels)}</span>
        {c.hint && <span className="collab-conflict-hint">{t(`merge_hint_${c.hint}`)}</span>}
        {validation && (
          <ul className="collab-findings">
            {c.findings.map(f => <li key={f.key}>{findingText(t, f)}</li>)}
          </ul>
        )}
      </button>
      <div className="collab-choices" role="radiogroup">
        {['mine', 'theirs'].map(side => (
          <label key={side} className={`collab-choice collab-choice-${side}`} style={{ '--side': COMPARE_COLORS[side] }}>
            <input type="radio" name={c.id} checked={choices[c.id] === side} onChange={() => choose(c.id, side)} />
            <span className="collab-choice-label">{side === 'mine' ? mineLabel : theirsLabel}</span>
            {!validation && c.field != null && <span className="collab-choice-value">{valueText(t, c, c[side])}</span>}
            {(validation || c.field == null) && <span className="collab-choice-value">{c[side] === undefined ? t('merge_absent') : t('merge_value_object')}</span>}
          </label>
        ))}
      </div>
    </li>
  )

  return (
    <div className="track-table-overlay collab-overlay collab-conflict-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {title ?? t('merge_title')}
          <span className="track-table-subtitle">{fill('compare_from_to', { before: theirsLabel, after: mineLabel })}</span>
        </span>
        <button className="track-table-close" onClick={onCancel} aria-label="close" disabled={busy}>✕</button>
      </div>
      <div className="track-table-scroll collab-scroll">
        <section className="collab-section">
          <h4>{t('merge_conflicts')}</h4>
          {fieldConflicts.length + validationRows.length === 0
            ? <p className="collab-empty">{t('merge_no_conflicts')}</p>
            : (
              <ul className="collab-conflicts">
                {fieldConflicts.map(c => row(c))}
                {validationRows.map(c => row(c, { validation: true }))}
              </ul>
            )}
        </section>
        {result.applied.length > 0 && (
          <details className="collab-section" open={fieldConflicts.length === 0}>
            <summary>{fill('merge_applied', { n: result.applied.length })}</summary>
            <ul className="collab-list collab-list-plain">
              {result.applied.map((a, i) => (
                <li key={i}>
                  <span className="collab-badge" style={{ '--badge': COMPARE_COLORS[a.kind] ?? COMPARE_COLORS.changed }}>{t(`compare_${a.kind}`)}</span>
                  <span className="collab-row-text">{entryText(t, a)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {live.warnings.length > 0 && (
          <details className="collab-section">
            <summary>{fill('merge_warnings', { n: live.warnings.length })}</summary>
            <ul className="collab-list collab-list-plain">
              {live.warnings.map(w => <li key={w.key}>{`${w.label ?? ''}: ${findingText(t, w)}`}</li>)}
            </ul>
          </details>
        )}
      </div>
      <div className="collab-footer">
        <span className={`collab-status ${open ? 'open' : 'done'}`}>
          {open ? fill('merge_conflicts_open', { n: open }) : t('merge_all_resolved')}
        </span>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>{t('btn_cancel')}</button>
        <button type="button" className="modal-btn collab-btn-primary" disabled={open > 0 || busy}
          title={open ? t('merge_apply_blocked') : undefined} onClick={() => onApply(live.record)}>
          {t('merge_apply')}
        </button>
      </div>
    </div>
  )
}
