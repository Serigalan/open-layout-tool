import { useState } from 'react'
import { useI18n } from '../locales/i18nContext'

/**
 * The Höhenplan's third view (decision 386): one selected point in full — where
 * it is, its height and gradients, its curve and reason, what it is at a
 * turnout — and its dependencies (decision 385): what it depends on and what
 * depends on it, each a link to that point. In the design mode they are made
 * and taken away here: a WA or ldS taken over into the other track, a point
 * across on a track beside made to depend on it or it on that one, a
 * dependency of one's own released.
 *
 * `point` the selected point of the route (null where none or several are),
 * `track` its track; `grades` { before, after }; `roleText` what it is;
 * `links` { kind, from, to } (switchChain.heightLinks), `kindOf(ref)` how a
 * linked point depends, `nameOf(ref)` its name; `across` the tracks beside
 * ({ trackId, dist }), `trackName(id)`; `canTakeOver` for a WA or ldS;
 * `note` what the last action said.
 */
export default function ElevationPointDetails({
  point, track, grades, roleText, links, kindOf, nameOf, design, across, trackName, canTakeOver, note,
  onPick, onTakeOver, onAddDependent, onDependOn, onRelease,
}) {
  const { t, fill, num } = useI18n()
  const [beside, setBeside] = useState('')
  if (!point) return <div className="profile-empty"><span>{t('elevation_point_none')}</span></div>

  const own = track?.heights?.[point.owner.index]
  const besideId = across.some(x => x.trackId === beside) ? beside : across[0]?.trackId ?? ''
  const ref = { trackId: point.owner.trackId, index: point.owner.index }
  const value = (v, digits, unit) => (v == null ? '–' : `${num(v, { digits })}${unit ? ` ${unit}` : ''}`)
  const rows = [
    [t('elevation_point_track'), track?.name || ref.trackId.slice(0, 8)],
    [t('elevation_station'), value(own?.station, 3, 'm')],
    [t('elevation_height'), value(point.z, 4, 'm')],
    [t('elevation_grade_before'), value(grades?.before == null ? null : grades.before * 1000, 2, '‰')],
    [t('elevation_grade_after'), value(grades?.after == null ? null : grades.after * 1000, 2, '‰')],
    [t('elevation_vcurve'), value(point.rv ?? null, 0, 'm')],
    [t('elevation_reason'), point.reason || '–'],
    [t('elevation_point_locked'), t(point.locked ? 'elevation_point_yes' : 'elevation_point_no')],
    [t('elevation_point_role'), roleText || t('elevation_point_free')],
  ]
  const linkList = (refs, release) => (refs.length ? (
    <ul className="profile-point-links">
      {refs.map(r => (
        <li key={`${r.trackId}|${r.index}`}>
          <button type="button" className="link-btn" onClick={() => onPick(r)}>{nameOf(r)}</button>
          {release && design && release(r) && (
            <button type="button" className="track-table-save-btn" title={t('elevation_release_hint')}
              onClick={() => onRelease(release(r))}>{t('elevation_release')}</button>
          )}
        </li>
      ))}
    </ul>
  ) : <span className="profile-hint">–</span>)

  return (
    <div className="profile-point">
      <section>
        <h4>{fill('elevation_point_title', { n: point.index + 1 })}</h4>
        <dl className="profile-point-facts">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>
      <section>
        <h4>{t('elevation_links')}</h4>
        <p className="profile-hint">{t(`elevation_link_kind_${links?.kind ?? 'none'}`)}</p>
        <h5>{t('elevation_links_from_title')}</h5>
        {/* Its own dependency is released here; a line or the standard one follows from where it lies. */}
        {linkList(links?.from ?? [], () => (links?.kind === 'own' ? ref : null))}
        <h5>{t('elevation_links_to_title')}</h5>
        {linkList(links?.to ?? [], (r) => (kindOf(r) === 'own' ? r : null))}
        {design ? (
          <div className="profile-point-tools">
            {canTakeOver && (
              <button className="track-table-save-btn" title={t('elevation_take_over_hint')} onClick={onTakeOver}>
                {t('elevation_take_over')}
              </button>
            )}
            {across.length > 0 ? (
              <>
                <label className="profile-edit">
                  {t('elevation_point_beside')}
                  <select className="settings-select" value={besideId} onChange={e => setBeside(e.target.value)}>
                    {across.map(x => <option key={x.trackId} value={x.trackId}>{`${trackName(x.trackId)} (${num(x.dist, { digits: 1 })} m)`}</option>)}
                  </select>
                </label>
                <button className="track-table-save-btn" title={t('elevation_add_dependent_hint')} onClick={() => onAddDependent(besideId)}>
                  {t('elevation_add_dependent')}
                </button>
                <button className="track-table-save-btn" title={t('elevation_depend_on_hint')} onClick={() => onDependOn(besideId)}>
                  {t('elevation_depend_on')}
                </button>
              </>
            ) : <span className="profile-hint">{t('elevation_point_no_beside')}</span>}
          </div>
        ) : <p className="profile-hint">{t('elevation_links_design_only')}</p>}
        {note && <p className="form-error">{note}</p>}
      </section>
    </div>
  )
}
