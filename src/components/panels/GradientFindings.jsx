import { useProject } from '../../hooks/useStore'
import { checkVertical, verticalFindings } from '../../utils/gradientCheck'
import { ruleById, severityLabelKey } from '../../utils/regelkatalog'
import { useI18n } from '../../locales/i18nContext'

/**
 * What the Höhenplan rules of DB Ril 800.0110 say about one track's gradient
 * — the list beside the profile, which draws the same findings in place.
 *
 * Read through the store's subscription, so it follows every height edited in
 * the profile. One line per rule, with how often it was found and where first,
 * in the colour of its step, as RuleFindings lists a dialog's.
 */
export default function GradientFindings({ trackId }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const track = project?.tracks?.find(tr => tr.id === trackId)
  if (!track) return <p className="selecting-hint">{t('elevation_rules_pick')}</p>
  if (!(track.heights?.length >= 2)) return <p className="selecting-hint">{t('elevation_rules_none')}</p>

  const check = checkVertical(track, { project, switches: project.switches })
  const found = verticalFindings(check)
  const unchecked = check.curves.filter(c => c.unchecked).length
  const where = (entry) => (entry.station ?? entry.from).toFixed(1)

  return (
    <>
      {found.length ? (
        <ul className="rule-findings">
          {found.map(f => (
            <li key={`${f.id}|${f.severity}`} className={`rule-sev-${f.severity}`}>
              {f.id} · {t(severityLabelKey(f.severity))}: {ruleById(f.id)?.title}
              {f.places > 1 && ` (${f.places}×)`}
              {' — '}{fill('elevation_rules_at', { station: where(f.first) })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rule-findings rule-findings-ok">✓ {t('elevation_rules_ok')}</p>
      )}
      {unchecked > 0 && <p className="selecting-hint">{fill('elevation_rules_unchecked', { n: unchecked })}</p>}
    </>
  )
}
