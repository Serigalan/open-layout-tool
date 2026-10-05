import { useState } from 'react'
import { commitImport } from '../../../storage'
import { generateId } from '../../../utils/identifierUtils'
import { recalcAbsLengths, rebuildCoords } from '../../../utils/trackModel'
import { parseRecords, buildElements, parseGradient, gradientHeights, gradientHeightCode } from '../../../utils/vermEsnImport'
import { readFileBuffer } from '../../../utils/fileUtils'
import { FILE_CRS_OPTIONS, projectCrsOptions } from '../../../utils/coordinateUtils'
import { HEIGHT_DATUMS, heightDatumLabel } from '../../../utils/heightDatums'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import ExchangeSection from './ExchangeSection'

/** One file of the import: a button to choose it, or the chosen `file` ({ name, detail }) with ✕. */
function FileSlot({ label, accept, onFile, file, pickLabel, removeLabel, disabled, onRemove }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {file ? (
        <div className="row">
          <div className="grow">
            <div className="file-slot-name text-ellipsis" title={file.name}>{file.name}</div>
            <div className="msg-hint msg-small">{file.detail}</div>
          </div>
          <button className="panel-btn" onClick={onRemove} title={removeLabel} aria-label={removeLabel}>✕</button>
        </div>
      ) : (
        <FilePickButton accept={accept} disabled={disabled} onFile={onFile}>{pickLabel}</FilePickButton>
      )}
    </div>
  )
}

/**
 * Verm.ESN: a TRA (alignment) and an optional GRA (gradient). Both files are
 * chosen first and imported together, the gradient only with the height datum
 * it is stated in.
 */
export default function VermEsnSection() {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  // The planes the project's tracks already lie in come first and the most
  // used one is preset — a survey usually belongs to the same frame. The track
  // is created in the plane the file is stated in, whichever that is.
  const projectCrs = projectCrsOptions(tracks)
  const otherCrs = FILE_CRS_OPTIONS.filter(o => !projectCrs.some(p => p.code === o.code))
  const [epsg, setEpsg] = useState(() => String(projectCrs[0]?.code ?? 5683))
  const [tra, setTra] = useState(null)              // { name, records, count }
  const [gra, setGra] = useState(null)              // { name, points, code }
  const [graHeightEpsg, setGraHeightEpsg] = useState('')   // chosen, never preset
  const [errors, setErrors] = useState([])
  const [notes, setNotes] = useState([])
  const [done, setDone] = useState(null)

  const readTra = async (file) => {
    setDone(null); setNotes([])
    try {
      const records = parseRecords(await readFileBuffer(file))
      // Element count and junctions do not depend on the plane: checked here
      // already, so a broken file shows before the import.
      const { elements, errors: errs } = buildElements(records, Number(epsg))
      setErrors(elements.length ? errs : [...errs, t('data_exchange_vermesn_tra_empty')])
      setTra(elements.length && !errs.length ? { name: file.name, records, count: elements.length } : null)
    } catch (err) {
      console.error('Verm.ESN import error:', err)
      setTra(null)
      setErrors([t('data_exchange_vermesn_tra_empty')])
    }
  }

  const readGra = async (file) => {
    setDone(null); setNotes([])
    const buffer = await readFileBuffer(file)
    const points = parseGradient(buffer)
    if (points.length < 2) {
      setGra(null)
      setErrors([t('data_exchange_vermesn_gra_empty')])
      return
    }
    setErrors([])
    setGra({ name: file.name, points, code: gradientHeightCode(buffer, file.name) })
  }

  const ready = !!project && !!tra && (!gra || !!graHeightEpsg)

  const importIt = () => {
    if (!ready) return
    const { elements, errors: errs, startStation } = buildElements(tra.records, Number(epsg))
    setErrors(errs)
    if (errs.length || !elements.length) return
    const recalced = recalcAbsLengths(elements)
    const length = recalced.reduce((sum, el) => sum + (el.length ?? 0), 0)
    const { heights, notes: hNotes } = gra ? gradientHeights(gra.points, startStation, length) : { heights: null, notes: [] }
    setNotes(hNotes)
    commitImport({ addTracks: [{
      id: generateId(), epsg: Number(epsg), coordinates: rebuildCoords(recalced), elements: recalced,
      ...(heights ? { heights, heightEpsg: Number(graHeightEpsg) } : {}),
    }] })
    setDone(fill(heights ? 'data_exchange_vermesn_done_heights' : 'data_exchange_vermesn_done',
      { name: tra.name, count: recalced.length, heights: heights?.length ?? 0 }))
    setTra(null)
    setGra(null)
  }

  const crsOption = o => <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>

  return (
    <ExchangeSection title={t('data_exchange_vermesn')}>
      <div className="form-field">
        <label>{t('data_exchange_vermesn_crs')}</label>
        <select className="settings-select" value={epsg} onChange={e => setEpsg(e.target.value)}>
          {projectCrs.length > 0 && (
            <optgroup label={t('data_exchange_crs_in_project')}>{projectCrs.map(crsOption)}</optgroup>
          )}
          <optgroup label={projectCrs.length > 0 ? t('data_exchange_crs_other') : t('data_exchange_crs_all')}>
            {otherCrs.map(crsOption)}
          </optgroup>
        </select>
      </div>
      <FileSlot label={t('data_exchange_vermesn_tra')} accept=".tra,.TRA" onFile={readTra}
        file={tra && { name: tra.name, detail: fill('data_exchange_vermesn_tra_loaded', { count: tra.count }) }}
        pickLabel={t('data_exchange_vermesn_tra_pick')} removeLabel={t('data_exchange_vermesn_tra_remove')}
        disabled={!project} onRemove={() => setTra(null)} />
      <FileSlot label={t('data_exchange_vermesn_gra')} accept=".gra,.GRA" onFile={readGra}
        file={gra && { name: gra.name, detail: fill('data_exchange_vermesn_gra_loaded', { count: gra.points.length }) }}
        pickLabel={t('data_exchange_vermesn_gra_pick')} removeLabel={t('data_exchange_vermesn_gra_remove')}
        disabled={!project} onRemove={() => setGra(null)} />
      {gra && (
        <div className="form-field">
          <label>{t('data_exchange_vermesn_height')}</label>
          <select className="settings-select" value={graHeightEpsg} onChange={e => setGraHeightEpsg(e.target.value)}>
            <option value="">{t('pointcloud_choose')}</option>
            {HEIGHT_DATUMS.map(d => <option key={d.epsg} value={d.epsg}>{heightDatumLabel(d.epsg)}</option>)}
          </select>
          {gra.code && (
            <span className="msg-hint msg-small">{fill('data_exchange_vermesn_height_code', { code: gra.code })}</span>
          )}
        </div>
      )}
      <button className="panel-btn panel-btn-full" disabled={!ready} onClick={importIt}>
        {t('data_exchange_import')}
      </button>
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={errors} />
      <MessageList items={notes} kind="warn" />
    </ExchangeSection>
  )
}
