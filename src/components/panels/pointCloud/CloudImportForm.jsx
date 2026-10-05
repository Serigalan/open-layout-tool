import { useState } from 'react'
import { crsLabel } from '../../../utils/coordinateUtils'
import { HEIGHT_DATUMS, heightDatumLabel } from '../../../utils/heightDatums'
import { fileSource } from '../../../utils/pointCloud/lasReader'
import { readCloudHeader } from '../../../utils/pointCloud/cloudReader'
import { probeExtent, projectPlane } from '../../../utils/pointCloud/cloudProbe'
import { startImport, previewPoints } from '../../../utils/pointCloud/pointCloudImport'
import { formatName, pointsAsText, PREVIEW_POINTS } from '../../../utils/pointCloud/lasText'
import { persistStorage, estimateCloudBytes } from '../../../utils/pointCloud/cloudStore'
import { CLOUD_CRS, count, crsHint, duration, mb, sizeText } from '../../../utils/pointCloud/cloudFormat'
import { downloadText } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import ReadOnlyField from '../../form/ReadOnlyField'
import Modal from '../../Modal'

/** A file's name without its point cloud extension. */
const baseName = (name) => name.replace(/\.(laz|las|e57)$/i, '')

/** The first points of the file as text, to read the coordinates before choosing their system. */
function PointsTextModal({ preview, onClose }) {
  const { t, fill } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(preview.text); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <Modal className="pointcloud-text-modal" title={fill('pointcloud_text_title', { n: PREVIEW_POINTS })} onClose={onClose}
      actions={<>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={copy}>
          {copied ? t('pointcloud_text_copied') : t('pointcloud_text_copy')}
        </button>
        <button type="button" className="modal-btn modal-btn-cancel"
          onClick={() => downloadText(preview.text, `${baseName(preview.name)}_${PREVIEW_POINTS}.txt`)}>
          {t('pointcloud_text_save')}
        </button>
        <button type="button" className="modal-btn modal-btn-primary" onClick={onClose}>{t('pointcloud_text_close')}</button>
      </>}>
      <pre className="pointcloud-text">{preview.text}</pre>
    </Modal>
  )
}

/** How far a running import has come, and the button that stops it. */
function ImportProgress({ run }) {
  const { t, fill } = useI18n()
  const p = run.progress
  const share = p?.totalBytes ? p.bytes / p.totalBytes : 0
  return (
    <div className="pointcloud-progress">
      <progress max={1} value={share} />
      <span className="pointcloud-meta">
        {p
          ? `${Math.floor(share * 100)} % · ${fill('pointcloud_points', { n: count(p.points) })} · `
            + `${fill('pointcloud_kept', { n: count(p.kept) })} · ${mb(p.bytesWritten)}`
          : t('pointcloud_starting')}
      </span>
      {p && (
        <span className="pointcloud-meta">
          {`${t('pointcloud_elapsed')} ${duration(p.elapsed)} · ${t('pointcloud_remaining')} ${duration(p.remaining)}`}
        </span>
      )}
      <button className="panel-btn panel-btn-danger panel-btn-full" onClick={() => run.abort()}>{t('pointcloud_abort')}</button>
    </div>
  )
}

/**
 * The import of a LAS, LAZ or E57 file into tiles. It asks for the horizontal and the
 * vertical datum of the file before anything is read — both required, neither
 * preselected (Entscheidung 118) — and checks the box the file states for
 * itself against the tracks, so a wrong choice shows before an hour of
 * reading. `onMessage` reports how it went, `onChanged` that the stored clouds
 * changed, `onRunning` whether an import runs.
 */
export default function CloudImportForm({ storage, onMessage, onChanged, onRunning }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const target = projectPlane(tracks)
  const [pick, setPick] = useState(null)        // { file, header } once a file is chosen
  const [crs, setCrs] = useState('')
  const [heightEpsg, setHeightEpsg] = useState('')
  const [run, setRunState] = useState(null)     // { abort, progress } while importing
  const [preview, setPreview] = useState(null)  // { busy } while reading, then { text, name }
  const setRun = (next) => { setRunState(next); onRunning?.(!!next) }

  const choose = async (file) => {
    onMessage(null)
    try {
      setPick({ file, header: await readCloudHeader(fileSource(file)) })
      setCrs('')
      setHeightEpsg('')
    } catch (err) {
      setPick(null)
      onMessage({ kind: 'error', text: `${t('pointcloud_not_las')} (${err.message})` })
    }
  }

  const showPreview = async () => {
    setPreview({ busy: true })
    try {
      const { header, points } = await previewPoints(pick.file, PREVIEW_POINTS)
      const labels = {
        format: t('pointcloud_text_format'), points: t('pointcloud_text_points'),
        scale: t('pointcloud_text_scale'), offset: t('pointcloud_text_offset'),
        first: t('pointcloud_text_first'), intensity: t('pointcloud_text_intensity'),
        scans: t('pointcloud_text_scans'), crs: t('pointcloud_text_crs'),
      }
      setPreview({ name: pick.file.name, text: pointsAsText(header, points, { name: pick.file.name, labels }) })
    } catch (err) {
      setPreview(null)
      onMessage({ kind: 'error', text: `${t('pointcloud_text_failed')}: ${err.message}` })
    }
  }

  const begin = async () => {
    if (!pick || !crs || !heightEpsg) return
    await persistStorage()
    const job = startImport({
      file: pick.file,
      projectId: project.id,
      meta: { name: baseName(pick.file.name), heightEpsg: Number(heightEpsg) },
      sourceCrs: Number(crs),
      targetCrs: target ?? Number(crs),
      onProgress: (progress) => setRunState(r => (r ? { ...r, progress } : r)),
    })
    setRun({ abort: job.abort, progress: null })
    try {
      const result = await job.done
      onMessage(result.status === 'done'
        ? { kind: 'done', text: fill('pointcloud_import_done', { points: count(result.index.points) }) }
        : { kind: 'done', text: t('pointcloud_import_aborted') })
      if (result.status === 'done') setPick(null)
    } catch (err) {
      onMessage({ kind: 'error', text: `${t('pointcloud_import_failed')}: ${err.message}` })
    }
    setRun(null)
    onChanged()
  }

  if (!pick) {
    return (
      <FilePickButton accept=".laz,.las,.e57" onFile={choose}>{t('pointcloud_import')}</FilePickButton>
    )
  }

  const probe = crs ? probeExtent(pick.header, Number(crs), tracks) : null
  const needed = estimateCloudBytes(pick.header.pointCount)
  return (
    <div className="pointcloud-import">
      <ReadOnlyField label={t('pointcloud_file')} value={`${pick.file.name} · ${mb(pick.file.size)}`} />
      <span className="pointcloud-meta">
        {`${formatName(pick.header)} · `
          + (pick.header.format === 'e57' ? `${fill('pointcloud_scans', { n: count(pick.header.scans.length) })} · ` : '')
          + `${fill('pointcloud_points', { n: count(pick.header.pointCount) })} · `
          + `${fill('pointcloud_needs', { size: sizeText(needed) })}`}
      </span>
      {pick.header.coordinateMetadata && (
        <span className="pointcloud-meta">{fill('pointcloud_file_crs', { crs: crsHint(pick.header.coordinateMetadata) })}</span>
      )}
      <button className="modal-btn modal-btn-cancel pointcloud-text-btn" disabled={preview?.busy} onClick={showPreview}>
        {preview?.busy ? t('pointcloud_text_reading') : fill('pointcloud_text_show', { n: PREVIEW_POINTS })}
      </button>
      {storage && needed > storage.free && (
        <p className="form-error">{fill('pointcloud_space_short', { size: sizeText(needed), free: sizeText(storage.free) })}</p>
      )}
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
          {HEIGHT_DATUMS.map(d => <option key={d.epsg} value={d.epsg}>{heightDatumLabel(d.epsg)}</option>)}
        </select>
      </div>
      {probe?.ok === true && <p className="selecting-hint">{t('pointcloud_probe_ok')}</p>}
      {probe?.ok === false && <p className="form-error">{t('pointcloud_probe_off')}</p>}
      {probe && probe.ok === null && <p className="selecting-hint">{t('pointcloud_probe_no_tracks')}</p>}
      {crs && <p className="selecting-hint">{fill('pointcloud_target', { crs: crsLabel(target ?? Number(crs)) })}</p>}
      {run ? <ImportProgress run={run} /> : (
        <div className="pointcloud-actions">
          <button className="panel-btn" disabled={!crs || !heightEpsg} onClick={begin}>{t('pointcloud_start')}</button>
          <button className="modal-btn modal-btn-cancel" onClick={() => setPick(null)}>{t('btn_cancel')}</button>
        </div>
      )}
      {preview?.text && <PointsTextModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
