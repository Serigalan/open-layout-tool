import { useEffect, useRef, useState } from 'react'
import { listClouds } from '../../utils/pointCloud/cloudStore'
import { scanClearance } from '../../utils/pointCloud/clearanceScan'
import { gaugeProfile, gaugeProfileRing, gaugeProfileAreas, DEFAULT_GAUGE_PROFILE } from '../../utils/gaugeProfiles'
import { currentProject } from '../../storage'
import { useI18n } from '../../locales/i18nContext'
import { useProject } from '../../hooks/useStore'

const fill = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), text)

/**
 * The clearance check along the whole track against the project's point
 * clouds on this device (AP 11.5): a list of the stretches where measured
 * points reach into the outline, each a click away in the cross section.
 * Absent where the project has no cloud here.
 */
export default function ClearanceScanSection({ track, onShowCrossSection }) {
  const { t } = useI18n()
  const project = useProject()
  const [clouds, setClouds] = useState([])
  const [run, setRun] = useState(null)       // { share } while checking
  const [result, setResult] = useState(null) // { trackId, stretches, checked, noGradient } | { error }
  const abortRef = useRef(null)

  useEffect(() => {
    let live = true
    listClouds(project.id).then(c => { if (live) setClouds(c) }).catch(() => {})
    return () => { live = false; abortRef.current?.abort() }
  }, [project.id])

  if (!clouds.length || !track) return null

  const start = async () => {
    const ctl = new AbortController()
    abortRef.current = ctl
    setResult(null)
    setRun({ share: 0 })
    const profile = gaugeProfile(currentProject()?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
    try {
      const r = await scanClearance({
        projectId: project.id, clouds, track,
        ring: gaugeProfileRing(profile.points), areas: gaugeProfileAreas(profile.einragungen),
        signal: ctl.signal, onProgress: (share) => setRun({ share }),
      })
      setResult({ trackId: track.id, ...r })
    } catch (err) {
      if (err?.name !== 'AbortError') setResult({ trackId: track.id, error: err.message })
    }
    setRun(null)
  }

  const shown = result?.trackId === track.id ? result : null

  return (
    <div className="element-form">
      <span className="create-element-section">{t('clearance_scan_title')}</span>
      <p className="selecting-hint">{t('clearance_scan_hint')}</p>
      {run ? (
        <>
          <progress max={1} value={run.share} style={{ width: '100%' }} />
          <button className="panel-btn panel-btn-danger panel-btn-full" onClick={() => abortRef.current?.abort()}>
            {t('btn_cancel')}
          </button>
        </>
      ) : (
        <button className="panel-btn panel-btn-full" onClick={start}>{t('clearance_scan_start')}</button>
      )}
      {shown?.error && <p className="form-error">{shown.error}</p>}
      {shown?.noGradient && <p className="form-error">{t('cross_section_clearance_no_gradient')}</p>}
      {shown && !shown.error && !shown.noGradient && (
        shown.stretches.length === 0
          ? <p className="selecting-hint">{fill(t('clearance_scan_none'), { n: shown.checked })}</p>
          : (
            <div className="clearance-stretches">
              <p className="form-error">{fill(t('clearance_scan_found'), { n: shown.stretches.length })}</p>
              {shown.stretches.map(s => (
                <button key={s.from} className="create-element-btn clearance-stretch"
                  onClick={() => onShowCrossSection?.({ trackId: track.id, station: s.deepestAt })}>
                  {`${s.from.toFixed(1)} – ${s.to.toFixed(1)} m · `
                    + fill(t('clearance_scan_row'), { n: s.inside.toLocaleString(), mm: Math.round(s.depth) })}
                </button>
              ))}
            </div>
          )
      )}
    </div>
  )
}
