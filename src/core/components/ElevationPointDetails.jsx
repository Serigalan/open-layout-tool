import { useState } from 'react'
import { useI18n } from '../locales/i18nContext'

/**
 * The Höhenplan's point tab, below the divider (decisions 386–387, 391): one selected point in full —
 * its track, gradients, lock and what it is at a turnout, and its station,
 * height, curve (with the Regelwert offered) and reason to edit (`editor`) —
 * and its dependencies (decision 385): what it depends on and what depends on
 * it, each a link to that point, and how (decisions 390, 392: as its ldS,
 * the gradient before or after it carried on — or on a line). A turnout's toe
 * is marked as such (`toe` the turnout's name): it is one point on all its
 * tracks, no dependency. In the design mode
 * they are made and changed here: a point picked on the map made to depend
 * on this one the way chosen, the way a point follows its own source
 * changed, and every dependency let go with the × behind it — a WA or ldS
 * let go of its rule (`freed`) is put back under it.
 *
 * `point` the selected point of the route (null where none or several are —
 * `count` of them, edited together with `editor`),
 * `track` its track; `grades` { before, after }; `roleText` what it is;
 * `links` { kind, mode, from, to } (switchChain.heightLinks), `linkOf(ref)`
 * those of a linked point, `nameOf(ref)` its name; `modes` the ways a point
 * may depend, `suggested` the one offered first; `picking` the way a point
 * being picked on the map will depend, or null; `note` what the last action
 * said — at the head, whichever part it came from.
 */
export default function ElevationPointDetails({
  point, count = 0, track, grades, roleText, links, linkOf, nameOf, design, modes, suggested, picking, note, editor, freed, toe = null,
  onPick, onPickDependent, onCancelPick, onSetMode, onRelease, onRestore,
}) {
  const { t, fill, num } = useI18n()
  const [chosen, setChosen] = useState(null)
  if (!point && !count) {
    return <div className="profile-empty profile-point-none"><span>{t('elevation_point_none')}</span><span className="profile-hint">{t('elevation_hint_edit')}</span></div>
  }
  const noteLine = note && <p className="form-error profile-point-note">{note}</p>
  // Several points: what they take together, no dependencies.
  if (!point) {
    return (
      <div className="profile-point">
        {noteLine}
        <section>
          <h4>{fill('elevation_selected', { n: count })}</h4>
          {editor}
        </section>
      </div>
    )
  }

  const mode = chosen ?? suggested ?? modes[0]
  const ref = { trackId: point.owner.trackId, index: point.owner.index }
  const value = (v, digits, unit) => (v == null ? '–' : `${num(v, { digits })}${unit ? ` ${unit}` : ''}`)
  const rows = [
    [t('elevation_point_track'), track?.name || ref.trackId.slice(0, 8)],
    [t('elevation_grade_before'), value(grades?.before == null ? null : grades.before * 1000, 2, '‰')],
    [t('elevation_grade_after'), value(grades?.after == null ? null : grades.after * 1000, 2, '‰')],
    [t('elevation_point_locked'), t(point.locked ? 'elevation_point_yes' : 'elevation_point_no')],
    [t('elevation_point_role'), roleText || t('elevation_point_free')],
  ]
  // How a point follows: its mode as words, or — its own dependency, in the
  // design mode — a choice that changes it.
  const howOf = (dependent) => {
    const l = dependent === ref ? links : linkOf(dependent)
    if (!l?.mode) return null
    if (design && l.kind === 'own') {
      // A way no longer offered (from an older project) stands first, until another is chosen.
      return (
        <select className="settings-select profile-point-mode" value={l.mode} title={t('elevation_dep_mode_hint')}
          onChange={e => onSetMode(dependent, e.target.value)}>
          {(modes.includes(l.mode) ? modes : [l.mode, ...modes]).map(m => (
            <option key={m} value={m} disabled={!modes.includes(m)}>{t(`elevation_dep_mode_${m}`)}</option>
          ))}
        </select>
      )
    }
    return <span className="profile-hint">{t(`elevation_dep_mode_${l.mode}`)}</span>
  }
  // `release(r)` the point whose dependency the × behind r lets go.
  const linkList = (refs, release, kind) => (refs.length ? (
    <ul className={`profile-point-links ${kind}`}>
      {refs.map(r => (
        <li key={`${r.trackId}|${r.index}`}>
          <button type="button" className="link-btn" onClick={() => onPick(r)}>{nameOf(r)}</button>
          {kind === 'to' && howOf(r)}
          {design && (
            <button type="button" className="profile-point-x" title={t('elevation_release_hint')} aria-label={t('elevation_release')}
              onClick={() => onRelease(release(r))}>×</button>
          )}
        </li>
      ))}
    </ul>
  ) : <span className="profile-hint">–</span>)

  return (
    <div className="profile-point">
      {noteLine}
      <section>
        <h4>
          {fill('elevation_point_title', { n: point.index + 1 })}
          {toe != null && <span className="profile-toe-tag">{fill('elevation_toe_tag', { name: toe })}</span>}
        </h4>
        {editor}
        <dl className="profile-point-facts">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>
      <section>
        <h4>{t('elevation_links')}</h4>
        <p className="profile-hint">
          {t(`elevation_link_kind_${freed ? 'free' : links?.toe || (toe != null && !links?.kind) ? 'toe' : links?.kind ?? 'none'}`)}
          {/* The toe's coupling is let go like a dependency. */}
          {design && links?.toe && (
            <button type="button" className="profile-point-x" title={t('elevation_release_hint')} aria-label={t('elevation_release')}
              onClick={() => onRelease(ref)}>×</button>
          )}
        </p>
        {freed && design && (
          <button className="track-table-save-btn" title={t('elevation_restore_hint')} onClick={onRestore}>{t('elevation_restore')}</button>
        )}
        <h5 className="profile-point-from"><span className="profile-point-dot" aria-hidden="true" />{t('elevation_links_from_title')}</h5>
        {(links?.from?.length ?? 0) > 0 && <div className="profile-point-how">{howOf(ref)}</div>}
        {/* Each × lets the point go of what it depends on — of a line through two points, both at once. */}
        {linkList(links?.from ?? [], () => ref, 'from')}
        <h5 className="profile-point-to"><span className="profile-point-dot" aria-hidden="true" />{t('elevation_links_to_title')}</h5>
        {linkList(links?.to ?? [], (r) => r, 'to')}
        {design ? (
          <div className="profile-point-tools">
            <label className="profile-edit">
              {t('elevation_dep_mode')}
              <select className="settings-select" value={mode} title={t('elevation_dep_mode_hint')} disabled={!!picking}
                onChange={e => setChosen(e.target.value)}>
                {modes.map(m => <option key={m} value={m}>{t(`elevation_dep_mode_${m}`)}</option>)}
              </select>
            </label>
            {picking ? (
              <>
                <span className="profile-hint profile-point-picking">{t('elevation_pick_dependent_hint')}</span>
                <button className="track-table-save-btn" onClick={onCancelPick}>{t('elevation_pick_cancel')}</button>
              </>
            ) : (
              <button className="track-table-save-btn" title={t('elevation_pick_dependent_hint')} onClick={() => onPickDependent(mode)}>
                {t('elevation_pick_dependent')}
              </button>
            )}
          </div>
        ) : <p className="profile-hint">{t('elevation_links_design_only')}</p>}
      </section>
    </div>
  )
}
