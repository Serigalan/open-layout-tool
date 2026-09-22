import { KATALOG, severityLabelKey } from '../utils/regelkatalog'

/**
 * The rule catalogue itself, read-only, inside the regelwerk popup — DB Ril
 * 800.0110 Linienführung as the repo holds it (AP R.7).
 *
 * It is the same file the element table is judged against, not a description
 * of it: every expression shown here is the one that was evaluated. That is
 * why the limits are printed as the expressions they are rather than as prose
 * — prose would be a second statement of the rule, and only one of the two
 * could be the one that runs.
 */

// The catalogue's own German titles are used for what belongs to the
// catalogue (the meaning of a step, the name of an element type); the app's
// own words around them are translated as everything else is.
const TYPE_TITLE = Object.fromEntries(KATALOG.element_types.map(type => [type.id, type.title]))
const FORM_TITLE = Object.fromEntries(
  KATALOG.element_types.flatMap(type => (type.forms ?? []).map(form => [form.id, form.title])))
const SCOPE_TITLE = { element: 'Element', boundary: 'Elementgrenze', cant_ramp: 'Überhöhungsrampe' }

const appliesTo = (rule) => {
  const applies = rule.applies_to
  const types = (applies.element_types ?? []).map(id => TYPE_TITLE[id] ?? id)
  const forms = (applies.forms ?? []).map(id => FORM_TITLE[id] ?? id)
  const what = forms.length ? forms : types
  return [SCOPE_TITLE[applies.scope] ?? applies.scope, what.join(', ')].filter(Boolean).join(' · ')
}

export default function RegelkatalogView({ t }) {
  const { catalog, rules, tables, open_points: openPoints } = KATALOG

  return (
    <>
      <p className="constraints-hint">
        {catalog.title} · v{catalog.version} · {t('optimize_regelwerk_gueltig_ab')}{' '}
        {catalog.gueltig_ab}
        {/* The Ril has a version and the rendering of it into rules has one of
            its own — they are different things and are said apart. */}
        {' — '}{t('constraints_katalog_revision')} {catalog.katalog_version} ({catalog.status})
      </p>
      <p className="constraints-hint">{t('constraints_katalog_hint')}</p>

      <h4 className="constraints-subsection">{t('constraints_severities')}</h4>
      <p className="constraints-hint">{KATALOG.aggregation}</p>
      <div className="constraints-severities">
        {KATALOG.severity_levels.map(level => (
          <span key={level.id} className={`constraints-severity rule-sev-${level.id}`}>
            {t(severityLabelKey(level.id))}
            {level.meaning && <span className="constraints-note">{level.meaning}</span>}
          </span>
        ))}
      </div>

      <h4 className="constraints-subsection">{t('table_rules')}</h4>
      <table className="track-table constraints-table">
        <thead>
          <tr>
            <th>{t('constraints_rule_applies')}</th>
            <th>{t('constraints_rule_limits')}</th>
            <th>{t('constraints_rule_steps')}</th>
            <th>{t('constraints_rule_status')}</th>
          </tr>
        </thead>
        <tbody>
          {rules.map(rule => (
            <tr key={rule.id}>
              <td className="constraints-value">
                {rule.id}
                <span className="constraints-note">{rule.title}</span>
                <span className="constraints-note">{appliesTo(rule)}</span>
              </td>
              <td>
                {rule.condition && (
                  <span className="constraints-expr">
                    {t('constraints_rule_condition')} {rule.condition}
                  </span>
                )}
                {Object.entries(rule.thresholds ?? {}).map(([name, spec]) => (
                  <span key={name} className="constraints-expr">
                    {name} = {spec.expr}{spec.unit && spec.unit !== '-' ? ` [${spec.unit}]` : ''}
                  </span>
                ))}
                {(rule.notes ?? []).map(note => (
                  <span key={note} className="constraints-note">{note}</span>
                ))}
              </td>
              <td>
                {rule.evaluation.map((entry, i) => (
                  <span key={i} className="constraints-expr">
                    {'else' in entry ? t('constraints_rule_else') : entry.if}
                    {' → '}
                    <span className={`rule-sev-${'else' in entry ? entry.else : entry.severity}`}>
                      {t(severityLabelKey('else' in entry ? entry.else : entry.severity))}
                    </span>
                  </span>
                ))}
              </td>
              <td className="constraints-where">
                {rule.status}
                {rule.open_point && <span className="constraints-note">{rule.open_point}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="constraints-subsection">{t('constraints_tables')}</h4>
      {Object.entries(tables).map(([id, table]) => (
        <div key={id}>
          <p className="constraints-hint">{table.title} [{table.unit}]</p>
          <table className="track-table constraints-table">
            <thead>
              <tr>
                <th>{table.key} [{table.key_unit}]</th>
                {table.pieces
                  ? <th>{table.unit}</th>
                  : Object.values(table.columns).map(name => <th key={name}>{name}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.pieces?.map((piece, i) => (
                <tr key={i}>
                  <td className="constraints-value">
                    {piece.key_min !== undefined ? `${piece.key_min}–` : `> ${piece.key_min_exclusive}–`}
                    {piece.key_max}
                  </td>
                  <td><span className="constraints-expr">{piece.expr}</span></td>
                </tr>
              ))}
              {table.rows?.map(row => (
                <tr key={row[table.key]}>
                  <td className="constraints-value">{row[table.key]}</td>
                  {Object.keys(table.columns).map(column => <td key={column}>{row[column]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {table.key_mode?.note && <p className="constraints-hint">{table.key_mode.note}</p>}
        </div>
      ))}

      <h4 className="constraints-subsection">{t('constraints_open_points')}</h4>
      <table className="track-table constraints-table">
        <tbody>
          {openPoints.map(point => (
            <tr key={point.id}>
              <td className="constraints-value">
                {point.id}
                <span className="constraints-note">{point.refs.join(', ')}</span>
              </td>
              <td>
                {point.topic}
                <span className="constraints-note">{point.assumption}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
