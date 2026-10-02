import { useEffect, useRef, useState } from 'react'
import { loadTracks } from '../../storage'
import { EPSG_OPTIONS, crsLabel } from '../../utils/coordinateUtils'
import { HEIGHT_DATUMS } from '../../utils/mapConstants'
import { readLasHeader, fileSource } from '../../utils/pointCloud/lasReader'
import { probeExtent, projectPlane } from '../../utils/pointCloud/cloudProbe'
import { startImport } from '../../utils/pointCloud/pointCloudImport'
import { listClouds, opfsAvailable, persistStorage } from '../../utils/pointCloud/cloudStore'

/**
 * Every plane a cloud may be stated in — all of them projStringFor knows, not
 * only the ones a new track is offered: a survey comes in whatever system the
 * surveyor used, DHDN Gauss-Krüger among them.
 */
const CLOUD_CRS = [...new Set([
  ...EPSG_OPTIONS.map(o => o.code),
  5680, 5676, 5677, 5678, 5679,   // DHDN / GK 1–5
  3396, 3397, 3398, 3399,         // PD/83, RD/83
  2397, 2398, 2399, 3068,         // 42/83, Soldner Berlin
])]

/** A translated text with its {{placeholders}} filled. */
const fill = (text, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), text)

const mb = (bytes) => `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`
const count = (n) => Number(n).toLocaleString()
const duration = (s) => {
  if (s == null || !Number.isFinite(s)) return '…'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`
}

/**
 * Point clouds of the project, on this device only (Entscheidung 119): the
 * import of a LAS/LAZ file into tiles, and the list of what is there.
 *
 * The import asks for the horizontal and the vertical datum of the file
 * before anything is read — both required, neither preselected (Entscheidung
 * 118) — and checks the box the file states for itself against the tracks, so
 * a wrong choice shows before an hour of reading.
 */
export default function PointCloudPanel({ t, project }) {
  const [clouds, setClouds] = useState(null)
  const [pick, setPick] = useState(null)        // { file, header } once a file is chosen
  const [crs, setCrs] = useState('')
  const [heightEpsg, setHeightEpsg] = useState('')
  const [run, setRun] = useState(null)          // { abort, progress } while importing
  const [message, setMessage] = useState(null)  // { kind: 'error'|'done', text }
  const fileRef = useRef(null)

  const tracks = loadTracks(project.id)
  const target = projectPlane(tracks)

  const refresh = () => listClouds(project.id).then(setClouds).catch(() => setClouds([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [project.id])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMessage(null)
    try {
      setPick({ file, header: await readLasHeader(fileSource(file)) })
      setCrs('')
      setHeightEpsg('')
    } catch (err) {
      setPick(null)
      setMessage({ kind: 'error', text: `${t('pointcloud_not_las')} (${err.message})` })
    }
  }

  const probe = pick && crs ? probeExtent(pick.header, Number(crs), tracks) : null

  const begin = async () => {
    if (!pick || !crs || !heightEpsg) return
    await persistStorage()
    const job = startImport({
      file: pick.file,
      projectId: project.id,
      meta: { name: pick.file.name.replace(/\.(laz|las)$/i, ''), heightEpsg: Number(heightEpsg) },
      sourceCrs: Number(crs),
      targetCrs: target ?? Number(crs),
      onProgress: (progress) => setRun(r => (r ? { ...r, progress } : r)),
    })
    setRun({ abort: job.abort, progress: null })
    try {
      const result = await job.done
      setMessage(result.status === 'done'
        ? { kind: 'done', text: fill(t('pointcloud_import_done'), { points: count(result.index.points) }) }
        : { kind: 'done', text: t('pointcloud_import_aborted') })
      if (result.status === 'done') setPick(null)
    } catch (err) {
      setMessage({ kind: 'error', text: `${t('pointcloud_import_failed')}: ${err.message}` })
    }
    setRun(null)
    refresh()
  }

  if (!opfsAvailable()) return <p className="form-error">{t('pointcloud_no_opfs')}</p>

  const p = run?.progress
  const share = p?.totalBytes ? p.bytes / p.totalBytes : 0

  return (
    <>
      <h2>{t('pointcloud_title')}</h2>
      <p className="selecting-hint">{t('pointcloud_hint')}</p>

      {!pick && !run && (
        <button className="panel-btn panel-btn-full" onClick={() => fileRef.current?.click()}>
          {t('pointcloud_import')}
        </button>
      )}
      <input ref={fileRef} type="file" accept=".laz,.las" style={{ display: 'none' }} onChange={onFile} />

      {pick && (
        <div className="pointcloud-import">
          <div className="form-field">
            <label>{t('pointcloud_file')}</label>
            <input type="text" readOnly value={`${pick.file.name} · ${mb(pick.file.size)}`} />
            <span className="pointcloud-meta">
              {`LAS ${pick.header.version}${pick.header.compressed ? ' (LAZ)' : ''} · `
                + `${fill(t('pointcloud_points'), { n: count(pick.header.pointCount) })}`}
            </span>
          </div>
          <div className="form-field">
            <label>{t('pointcloud_crs')}</label>
            <select value={crs} disabled={!!run} onChange={e => setCrs(e.target.value)}>
              <option value="">{t('pointcloud_choose')}</option>
              {CLOUD_CRS.map(code => <option key={code} value={code}>{crsLabel(code)}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>{t('pointcloud_height')}</label>
            <select value={heightEpsg} disabled={!!run} onChange={e => setHeightEpsg(e.target.value)}>
              <option value="">{t('pointcloud_choose')}</option>
              {HEIGHT_DATUMS.map(d => <option key={d.epsg} value={d.epsg}>{`${d.label} (EPSG ${d.epsg})`}</option>)}
            </select>
          </div>
          {probe && probe.ok === true && <p className="selecting-hint">{t('pointcloud_probe_ok')}</p>}
          {probe && probe.ok === false && <p className="form-error">{t('pointcloud_probe_off')}</p>}
          {probe && probe.ok === null && <p className="selecting-hint">{t('pointcloud_probe_no_tracks')}</p>}
          {crs && (
            <p className="selecting-hint">
              {fill(t('pointcloud_target'), { crs: crsLabel(target ?? Number(crs)) })}
            </p>
          )}

          {run ? (
            <div className="pointcloud-progress">
              <progress max={1} value={share} />
              <span className="pointcloud-meta">
                {p
                  ? `${Math.floor(share * 100)} % · ${fill(t('pointcloud_points'), { n: count(p.points) })} · `
                    + `${fill(t('pointcloud_kept'), { n: count(p.kept) })} · ${mb(p.bytesWritten)}`
                  : t('pointcloud_starting')}
              </span>
              {p && (
                <span className="pointcloud-meta">
                  {`${t('pointcloud_elapsed')} ${duration(p.elapsed)} · ${t('pointcloud_remaining')} ${duration(p.remaining)}`}
                </span>
              )}
              <button className="panel-btn panel-btn-danger panel-btn-full" onClick={() => run.abort()}>
                {t('pointcloud_abort')}
              </button>
            </div>
          ) : (
            <div className="pointcloud-actions">
              <button className="panel-btn" disabled={!crs || !heightEpsg} onClick={begin}>
                {t('pointcloud_start')}
              </button>
              <button className="modal-btn modal-btn-cancel" onClick={() => setPick(null)}>
                {t('btn_cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      {message && <p className={message.kind === 'error' ? 'form-error' : 'selecting-hint'}>{message.text}</p>}

      <h3 className="pointcloud-list-title">{t('pointcloud_list')}</h3>
      {clouds == null && <p className="selecting-hint">…</p>}
      {clouds?.length === 0 && <p className="selecting-hint">{t('pointcloud_none')}</p>}
      {clouds?.map(c => (
        <div key={c.id} className="pointcloud-item">
          <strong>{c.name}</strong>
          <span className="pointcloud-meta">{`${fill(t('pointcloud_points'), { n: count(c.points) })} · ${mb(c.bytes)}`}</span>
        </div>
      ))}
    </>
  )
}
