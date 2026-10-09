import { useEffect, useRef, useState } from 'react'
import { readableClouds } from '../../utils/pointCloud/projectClouds'
import { scanClearance } from '../../utils/pointCloud/clearanceScan'
import { gaugeProfile, gaugeProfileRing, gaugeProfileAreas, DEFAULT_GAUGE_PROFILE } from '../../utils/gaugeProfiles'
import { heightContext } from '../../utils/switchGradient'
import { currentProject } from '../../storage'
import { useI18n } from '../../locales/i18nContext'
import { tOr, formatDate } from '../../locales/i18n'
import { useProject } from '../../hooks/useStore'
import { useMayEditClouds } from '../../hooks/useCurrentUser'
import useServerRun, { runIsActive, runsOnServer } from '../../../server/useServerRun'
import useRegistrationSession from '../../hooks/useRegistrationSession'
import FormSection from '../form/FormSection'
import ServerRunStatus from './pointCloud/ServerRunStatus'


/**
 * The clearance check along the whole track against the project's point
 * clouds — on the server and on this device (AP 11.5, 13.6): a list of the stretches where measured
 * points reach into the outline, each a click away in the cross section.
 * Absent where the project has no cloud here.
 *
 * Where every cloud lies on the server and the user may start jobs there, the
 * check runs on the server (AP 13.7, decision 237): the window may be closed,
 * and the last result for the track is there for every member afterwards.
 */
export default function ClearanceScanSection({ track, onShowCrossSection }) {
  const { t, fill, language } = useI18n()
  const project = useProject()
  const mayEdit = useMayEditClouds()
  const [clouds, setClouds] = useState([])
  const [run, setRun] = useState(null)       // { share } while checking
  const [result, setResult] = useState(null) // { trackId, stretches, checked, noGradient } | { error }
  const abortRef = useRef(null)

  const { cloudsVersion } = useRegistrationSession(project.id)
  useEffect(() => {
    let live = true
    readableClouds(project.id).then(c => { if (live) setClouds(c) }).catch(() => {})
    return () => { live = false }
  }, [project.id, cloudsVersion])
  useEffect(() => () => abortRef.current?.abort(), [])

  const onServer = runsOnServer(clouds, mayEdit)
  const server = useServerRun(project.id, 'clearance', { trackId: track?.id ?? '' }, clouds.some(c => c.server) && !!track)

  if (!clouds.length || !track) return null

  const profileParams = () => {
    const profile = gaugeProfile(currentProject()?.gaugeProfile ?? DEFAULT_GAUGE_PROFILE)
    return { ring: gaugeProfileRing(profile.points), areas: gaugeProfileAreas(profile.einragungen) }
  }

  const startOnServer = () => {
    setResult(null)
    server.start(
      { track, ...heightContext(project.tracks, project.switches, track), ...profileParams() },
      { trackId: track.id, name: track.name ?? '' },
    )
  }

  const start = async () => {
    const ctl = new AbortController()
    abortRef.current = ctl
    setResult(null)
    setRun({ share: 0 })
    try {
      const r = await scanClearance({
        projectId: project.id, clouds, track, tracks: project.tracks, switches: project.switches,
        ...profileParams(),
        signal: ctl.signal, onProgress: (share) => setRun({ share }),
      })
      setResult({ trackId: track.id, ...r })
    } catch (err) {
      if (err?.name !== 'AbortError') setResult({ trackId: track.id, error: err.message })
    }
    setRun(null)
  }

  // What the browser found just now, else the last run on the server for this track.
  const fromServer = server.run?.status === 'done' && server.run.result ? { ...server.run.result, run: server.run } : null
  const shown = result?.trackId === track.id ? result : fromServer
  const serverBusy = runIsActive(server.run)

  return (
    <FormSection title={t('clearance_scan_title')}>
      <p className="selecting-hint">{t('clearance_scan_hint')}</p>
      {run ? (
        <>
          <progress className="full-width" max={1} value={run.share} />
          <span className="range-use">{t('pointcloud_runs_in_browser')}</span>
          <button className="panel-btn panel-btn-danger panel-btn-full" onClick={() => abortRef.current?.abort()}>
            {t('btn_cancel')}
          </button>
        </>
      ) : serverBusy ? (
        <ServerRunStatus run={server.run} mayCancel={mayEdit} onCancel={server.cancel} />
      ) : (
        <button className="panel-btn panel-btn-full" onClick={onServer ? startOnServer : start}>{t('clearance_scan_start')}</button>
      )}
      {server.error && <p className="form-error">{tOr(t, `pointcloud_err_${server.error.code}`, server.error.message)}</p>}
      {server.run?.status === 'failed' && !run && <p className="form-error">{fill('server_run_failed', { reason: server.run.error ?? '' })}</p>}
      {shown?.run && <span className="range-use">{fill('server_run_result_of', { date: formatDate(shown.run.finishedAt, language, { time: true }) })}</span>}
      {shown?.error && <p className="form-error">{shown.error}</p>}
      {shown?.noGradient && <p className="form-error">{t('cross_section_clearance_no_gradient')}</p>}
      {shown && !shown.error && !shown.noGradient && (
        shown.stretches.length === 0
          ? <p className="selecting-hint">{fill('clearance_scan_none', { n: shown.checked })}</p>
          : (
            <div className="clearance-stretches">
              <p className="form-error">{fill('clearance_scan_found', { n: shown.stretches.length })}</p>
              {shown.stretches.map(s => (
                <button key={s.from} className="create-element-btn clearance-stretch"
                  onClick={() => onShowCrossSection?.({ trackId: track.id, station: s.deepestAt })}>
                  {`${s.from.toFixed(1)} – ${s.to.toFixed(1)} m · `
                    + fill('clearance_scan_row', { n: s.inside.toLocaleString(), mm: Math.round(s.depth) })}
                </button>
              ))}
            </div>
          )
      )}
    </FormSection>
  )
}
