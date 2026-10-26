import { useMemo, useState } from 'react'
import { useProject } from '../../hooks/useStore'
import { computeOtherTrack } from '../../storage'
import { couplingOf, otherTrackHeights, planeDeviations, switchesOfTrack, switchLds } from '../../utils/elevation'
import FormSection from '../form/FormSection'
import { useI18n } from '../../locales/i18nContext'

/**
 * The switches of the track on show — of every track of the route on show —
 * each with the button that works out its other tracks from this one
 * (decision 383): the track on show is the one given and keeps its points,
 * only those the coupling rules bind follow; nothing is worked out on its
 * own. Beside each, whether it would change anything and which tracks.
 */
export default function SwitchHeightsList({ trackIds }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const [said, setSaid] = useState(null)   // { key, text } — what the last click came to
  const key = trackIds.join('|')
  const rows = useMemo(() => {
    if (!project) return []
    const nameOf = (id) => {
      const tr = project.tracks.find(x => x.id === id)
      return tr?.name || id.slice(0, 8)
    }
    return key.split('|').filter(Boolean).flatMap(trackId => switchesOfTrack(project, trackId).map(entry => {
      const r = otherTrackHeights(project, entry.sw.switchId, trackId)
      const changed = r.project && r.project !== project
        ? r.project.tracks.filter((tr, i) => tr !== project.tracks[i]).map(tr => nameOf(tr.id))
        : []
      const c = entry.side === 'main' || entry.side === 'branch' ? couplingOf(project.tracks, project.switches, entry.sw) : null
      const off = c ? planeDeviations(c) : []
      return { ...entry, trackId, trackName: nameOf(trackId), error: r.error ?? null, changed, off }
    }))
  }, [project, key])

  if (!rows.length) return null
  const swName = (sw) => [sw.name, sw.label && `(${sw.label})`].filter(Boolean).join(' ')
  const title = (row) => (row.other
    ? fill('switch_heights_crossover', { a: swName(row.sw), b: swName(row.other) })
    : swName(row.sw))
  const run = (row) => {
    const r = computeOtherTrack(row.sw.switchId, row.trackId)
    const k = `${row.sw.switchId}|${row.trackId}`
    setSaid(r.refused ? { key: k, text: t('switch_heights_refused') }
      : r.error ? { key: k, text: t(`switch_heights_err_${r.error}`) } : null)
  }
  const many = new Set(rows.map(r => r.trackId)).size > 1

  return (
    <FormSection title={t('switch_heights_title')} info={t('switch_heights_hint')}>
      {rows.map(row => {
        const k = `${row.sw.switchId}|${row.trackId}`
        return (
          <div key={k} className="switch-heights-row">
            <span className="switch-heights-name">
              {title(row)}{' · '}{t(`switch_heights_side_${row.side ?? 'none'}`)}{many && ` · ${row.trackName}`}
            </span>
            {row.error
              ? <span className="selecting-hint">{t(`switch_heights_err_${row.error}`)}</span>
              : row.changed.length
                ? <span className="selecting-hint">{fill('switch_heights_would', { tracks: row.changed.join(', ') })}</span>
                : <span className="rule-findings-ok">✓ {t('switch_heights_same')}</span>}
            {row.off.length > 0 && (
              <span className="selecting-hint">{fill('switch_heights_plane_off', {
                n: row.off.length, dz: (Math.max(...row.off.map(d => Math.abs(d.dz))) * 1000).toFixed(0),
              })}</span>
            )}
            {row.side !== 'crossing' && row.side && switchLds(row.sw) == null && (
              <span className="selecting-hint">{t('switch_heights_no_lds')}</span>
            )}
            <button className="panel-btn secondary" disabled={!!row.error || !row.changed.length} onClick={() => run(row)}>
              {t('switch_heights_compute')}
            </button>
            {said?.key === k && <p className="form-error">{said.text}</p>}
          </div>
        )
      })}
    </FormSection>
  )
}
