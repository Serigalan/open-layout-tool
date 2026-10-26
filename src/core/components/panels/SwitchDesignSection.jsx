import { useMemo } from 'react'
import { useProject, useSwitchDesign } from '../../hooks/useStore'
import { setSwitchDesignMode } from '../../storage'
import { switchMisfits } from '../../utils/elevation'
import { portTrack, turnoutLinePort } from '../../utils/track'
import InfoTip from '../form/InfoTip'
import { useI18n } from '../../locales/i18nContext'

/**
 * The design mode for turnouts (Entwurfsmodus Weichen, decisions 384–385):
 * a switch under the Höhenplan's heading. Off, a turnout's branch follows its
 * main route at WA and ldS; on, it does not, and in the profile a point is
 * made to depend on another — a WA or ldS taken over into the other track,
 * a point added across from one —, which holds in both. It ends only once
 * every turnout fits — until then the list says where one does not, and a
 * click shows the track to take it over from.
 */
export default function SwitchDesignSection({ onShowProfile }) {
  const { t, fill, num } = useI18n()
  const project = useProject()
  const design = useSwitchDesign()
  const misfits = useMemo(() => (project ? switchMisfits(project) : []), [project])
  if (!project?.switches?.length) return null
  const swName = (sw) => [sw.name, sw.label && `(${sw.label})`].filter(Boolean).join(' ')
  const what = (m) => fill(`switch_design_off_${m.at}`, {
    dz: num(Math.abs(m.dz) * 1000, { digits: 1 }), way: t(m.dz > 0 ? 'switch_design_higher' : 'switch_design_lower'),
  })
  // A gap is taken over from the main route, most of the time.
  const trackOf = (m) => portTrack(m.sw, turnoutLinePort(m.sw))
  const stuck = design && misfits.length > 0
  return (
    <div className="switch-design">
      <label className={`switch-design-toggle${stuck ? ' disabled' : ''}`} title={stuck ? t('switch_design_cannot_end') : undefined}>
        <input type="checkbox" role="switch" checked={design} disabled={stuck}
          onChange={e => setSwitchDesignMode(e.target.checked)} />
        <span>{t('switch_design_mode')}</span>
      </label>
      <InfoTip text={t('switch_design_hint')} />
      {design && (stuck ? (
        <div className="switch-design-open">
          <p className="selecting-hint">{fill('switch_design_open', { n: misfits.length })}</p>
          <ul>
            {misfits.map((m, i) => (
              <li key={`${m.sw.switchId}|${m.at}|${i}`}>
                <button type="button" className="link-btn" onClick={() => onShowProfile?.(trackOf(m))}>{swName(m.sw)}</button>
                {' · '}{what(m)}
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="rule-findings-ok">✓ {t('switch_design_all_fit')}</p>)}
    </div>
  )
}
