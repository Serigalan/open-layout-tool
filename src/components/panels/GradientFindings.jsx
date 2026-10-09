import { useProject } from '../../hooks/useStore'
import { checkVertical, verticalFindings } from '../../utils/gradientCheck'
import { couplingOf, pairedHeights, planeDeviations, switchLds } from '../../utils/switchGradient'
import { isLinkSwitch, portsOf } from '../../utils/switchModel'
import { ruleById, severityLabelKey } from '../../utils/regelkatalog'
import { useI18n } from '../../locales/i18nContext'

/**
 * What the Höhenplan rules of DB Ril 800.0110 say about one track's gradient
 * — the list beside the profile, which draws the same findings in place.
 *
 * Read through the store's subscription, so it follows every height edited in
 * the profile. One line per rule, with how often it was found and where first,
 * in the colour of its step, as RuleFindings lists a dialog's. Below, the
 * turnouts on the track and whether their gradient is coupled (switchGradient).
 */
export default function GradientFindings({ trackId }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const track = project?.tracks?.find(tr => tr.id === trackId)
  if (!track) return <p className="selecting-hint">{t('elevation_rules_pick')}</p>
  const turnouts = (project.switches ?? []).filter(sw => !isLinkSwitch(sw)
    && portsOf(sw).some(p => sw[p.trackKey] === track.id))
  const switchLines = turnouts.map(sw => {
    const c = couplingOf(project.tracks, project.switches, sw)
    const name = sw.name ?? sw.label ?? ''
    if (c) {
      const station = (c.main.track.id === track.id ? c.ldsMain : c.branch.track.id === track.id ? c.ldsBranch : null)
      if (station == null) return null
      // Coupled where its points already lie in pairs on the sleepers — else
      // they will with the next write that reaches the turnout, or the button.
      const pending = !sw.heightsLocked && pairedHeights(c, 'main')
      const key = sw.heightsLocked ? 'elevation_switch_locked' : pending ? 'elevation_switch_pending' : 'elevation_switch_coupled'
      const line = fill(key, { name, label: sw.label ?? '', station: station.toFixed(2) })
      // Where the two tracks no longer lie in the turnout's plane (decision 260).
      const off = pending ? [] : planeDeviations(c)
      if (!off.length) return line
      const worst = Math.max(...off.map(d => Math.abs(d.dz)))
      return [line, fill('elevation_switch_plane_off', { name, label: sw.label ?? '', n: off.length, dz: (worst * 1000).toFixed(0) })]
    }
    if ((sw.kind ?? 'turnout') === 'turnout' && switchLds(sw) == null) {
      return fill('elevation_switch_no_lds', { name, label: sw.label ?? '' })
    }
    return null
  }).flat().filter(Boolean)
  const switchList = switchLines.length > 0 && (
    <ul className="rule-findings">{switchLines.map(line => <li key={line}>{line}</li>)}</ul>
  )
  if (!(track.heights?.length >= 2)) {
    return <><p className="selecting-hint">{t('elevation_rules_none')}</p>{switchList}</>
  }

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
      {switchList}
    </>
  )
}
