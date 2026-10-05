import { useRef, useState } from 'react'
import { commitImport, loadTracks } from '../../../storage'
import { generateId } from '../../../utils/identifierUtils'
import { nextTrackName, rebuildCoords, recalcAbsLengths } from '../../../utils/trackModel'
import { parseGleislageCsv, parseUeberhoehungCsv, listStrecken, buildTracksFromCsv, CSV_EPSG } from '../../../utils/gleislageCsvImport'
import { readFileText } from '../../../utils/fileUtils'
import { FILE_CRS_OPTIONS } from '../../../utils/coordinateUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import ExchangeSection from './ExchangeSection'

/** A plane picker over every CRS the app knows. */
function CrsField({ label, value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select className="settings-select" value={value} onChange={e => onChange(e.target.value)}>
        {FILE_CRS_OPTIONS.map(o => <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>)}
      </select>
    </div>
  )
}

/**
 * The Gleislage CSV export. Parsing it (tens of MB) yields the line numbers in
 * it; the chosen one is then turned into tracks, with the cants of the
 * optional Überhöhung export.
 */
export default function CsvSection() {
  const { t, fill } = useI18n()
  const project = useProject()
  const rowsRef = useRef(null)       // parsed rows, kept out of state
  const cantRowsRef = useRef(null)
  const [cantCount, setCantCount] = useState(0)
  const [strecken, setStrecken] = useState([])
  const [strecke, setStrecke] = useState('3824')
  const [sourceEpsg, setSourceEpsg] = useState(String(CSV_EPSG))
  const [targetEpsg, setTargetEpsg] = useState(String(CSV_EPSG))
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)

  const readCsv = async (file) => {
    setErrors([]); setBusy(true); setStrecken([])
    try {
      const rows = parseGleislageCsv(await readFileText(file))
      rowsRef.current = rows
      const list = listStrecken(rows)
      setStrecken(list)
      setStrecke(s => (list.some(x => x.strecke === s) ? s : (list[0]?.strecke ?? '')))
    } catch (err) {
      rowsRef.current = null
      setErrors([`${t('import_parse_error')}: ${err.message}`])
    } finally {
      setBusy(false)
    }
  }

  const readCant = async (file) => {
    setErrors([]); setBusy(true)
    try {
      cantRowsRef.current = parseUeberhoehungCsv(await readFileText(file))
      setCantCount(cantRowsRef.current.length)
    } catch (err) {
      cantRowsRef.current = null
      setCantCount(0)
      setErrors([`${t('import_parse_error_cant')}: ${err.message}`])
    } finally {
      setBusy(false)
    }
  }

  const importIt = () => {
    if (!rowsRef.current || !strecke || !project) return
    const { tracks: parsed, errors: errs } = buildTracksFromCsv(rowsRef.current, strecke, cantRowsRef.current,
      { sourceEpsg: Number(sourceEpsg), targetEpsg: Number(targetEpsg) })
    setErrors(errs)
    if (!parsed.length) return
    const names = new Set(loadTracks().map(tr => tr.name).filter(Boolean))
    commitImport({ addTracks: parsed.map(tr => {
      const elements = recalcAbsLengths(tr.elements)
      const name = names.has(tr.name) ? nextTrackName(tr.name.split('.')[0], names) : tr.name
      names.add(name)
      return { ...tr, id: generateId(), name, elements, coordinates: rebuildCoords(elements) }
    }) })
  }

  return (
    <ExchangeSection title={t('data_exchange_csv')} description={t('data_exchange_csv_desc')}>
      <FilePickButton accept=".csv,text/csv" disabled={!project || busy} onFile={readCsv}>
        {busy ? t('data_exchange_csv_reading') : t('data_exchange_csv_choose')}
      </FilePickButton>
      {strecken.length > 0 && (
        <>
          <FilePickButton accept=".csv,text/csv" disabled={busy} onFile={readCant} className="panel-btn panel-btn-full mt-2">
            {cantCount ? fill('data_exchange_csv_cant_loaded', { n: cantCount }) : t('data_exchange_csv_cant')}
          </FilePickButton>
          <div className="mt-6">
            <CrsField label={t('data_exchange_csv_source_crs')} value={sourceEpsg} onChange={setSourceEpsg} />
          </div>
          <CrsField label={t('data_exchange_csv_target_crs')} value={targetEpsg} onChange={setTargetEpsg} />
          <div className="form-field">
            <label>{t('data_exchange_csv_line')}</label>
            <select className="settings-select" value={strecke} onChange={e => setStrecke(e.target.value)}>
              {strecken.map(s => <option key={s.strecke} value={s.strecke}>{s.strecke} ({s.count})</option>)}
            </select>
          </div>
          <button className="panel-btn panel-btn-full mt-2" disabled={!strecke} onClick={importIt}>
            {t('data_exchange_import')}
          </button>
        </>
      )}
      <MessageList items={errors} className="mt-6 scroll-list" />
    </ExchangeSection>
  )
}
