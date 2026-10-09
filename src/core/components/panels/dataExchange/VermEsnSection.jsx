import { useState } from 'react'
import { commitImport, saveReferenceAxis } from '../../../storage'
import { generateId } from '../../../utils/identifierUtils'
import { recalcAbsLengths, rebuildCoords } from '../../../utils/trackModel'
import { parseRecords, buildElements, parseGradient, gradientHeights, gradientHeightCode } from '../../../utils/vermEsnImport'
import { readFileBuffer } from '../../../utils/fileUtils'
import { REFERENCE_MAX_LENGTH, buildReferenceAxis } from '../../../utils/referenceAxis'
import { FILE_CRS_OPTIONS, projectCrsOptions } from '../../../utils/coordinateUtils'
import { HEIGHT_DATUMS, heightDatumLabel } from '../../../utils/heightDatums'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import NumberInput from '../../form/NumberInput'
import ExchangeSection from './ExchangeSection'
import ReferenceAxisList from './ReferenceAxisList'
import VermEsnExport from './VermEsnExport'

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
 * it is stated in — as a track, or as a reference axis (Paket V): only its
 * points every centimetre, at most REFERENCE_MAX_LENGTH of it, the stretch
 * chosen in the axis' own stationing where it is longer (Entscheidung 195).
 * Below, the export of the project's tracks into the same files.
 */
export default function VermEsnSection() {
  const { t, fill, num } = useI18n()
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
  const [asReference, setAsReference] = useState(false)
  const [range, setRange] = useState(null)          // { from, to } in the TRA's stationing

  const readTra = async (file) => {
    setDone(null); setNotes([])
    try {
      const records = parseRecords(await readFileBuffer(file))
      // Element count and junctions do not depend on the plane: checked here
      // already, so a broken file shows before the import.
      const { elements, errors: errs } = buildElements(records, Number(epsg))
      setErrors(elements.length ? errs : [...errs, t('data_exchange_vermesn_tra_empty')])
      const ok = elements.length && !errs.length
      const { startStation } = buildElements(records, Number(epsg))
      const length = elements.reduce((sum, el) => sum + (el.length ?? 0), 0)
      setTra(ok ? { name: file.name, records, count: elements.length, startStation: startStation ?? 0, length } : null)
      if (ok) setRange({ from: startStation ?? 0, to: (startStation ?? 0) + Math.min(length, REFERENCE_MAX_LENGTH) })
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

  // The stretch read as a reference axis: inside the axis, at most REFERENCE_MAX_LENGTH.
  const axisEnd = tra ? tra.startStation + tra.length : 0
  const rangeError = !asReference || !tra || !range ? null
    : !(Number(range.to) > Number(range.from)) || Number(range.from) < tra.startStation - 1e-6 || Number(range.to) > axisEnd + 1e-6
      ? 'data_exchange_reference_range_outside'
      : Number(range.to) - Number(range.from) > REFERENCE_MAX_LENGTH + 1e-6 ? 'data_exchange_reference_range_long' : null
  const ready = !!project && !!tra && (!gra || !!graHeightEpsg) && !rangeError

  const importReference = () => {
    const { elements, errors: errs, startStation } = buildElements(tra.records, Number(epsg))
    setErrors(errs)
    if (errs.length || !elements.length) return
    const from = Number(range.from), to = Number(range.to)
    const whole = from <= tra.startStation + 1e-6 && to >= axisEnd - 1e-6
    const base = tra.name.replace(/\.tra$/i, '')
    const axis = buildReferenceAxis({
      name: whole ? base : `${base} ${num(from, { digits: 0 })}–${num(to, { digits: 0 })}`,
      epsg: Number(epsg), elements, startStation: startStation ?? 0, from, to,
      gradient: gra?.points ?? null, heightEpsg: gra ? Number(graHeightEpsg) : null,
      tra: tra.name, gra: gra?.name ?? null,
    })
    saveReferenceAxis(axis)
    setDone(fill(axis.points.z ? 'data_exchange_reference_done_heights' : 'data_exchange_reference_done', {
      name: axis.name, n: num(axis.points.de.length, { digits: 0 }),
    }))
    setNotes(gra && !axis.points.z ? [t('data_exchange_reference_no_heights')] : [])
    setTra(null)
    setGra(null)
  }

  const importIt = () => {
    if (!ready) return
    if (asReference) { importReference(); return }
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
      <label className="transition-curve-row">
        <input type="checkbox" checked={asReference} onChange={e => setAsReference(e.target.checked)} />
        <span>{t('data_exchange_reference_toggle')}</span>
      </label>
      {asReference && <p className="msg-hint msg-small">{t('data_exchange_reference_hint')}</p>}
      {asReference && tra && range && (
        <>
          <p className="msg-hint msg-small">{fill('data_exchange_reference_axis', {
            from: num(tra.startStation, { digits: 2 }), to: num(axisEnd, { digits: 2 }), l: num(tra.length, { digits: 1, unit: 'm' }),
          })}</p>
          <div className="row">
            <div className="form-field grow">
              <label>{t('data_exchange_reference_from')}</label>
              <NumberInput step={10} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            </div>
            <div className="form-field grow">
              <label>{t('data_exchange_reference_to')}</label>
              <NumberInput step={10} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
            </div>
          </div>
          {rangeError && <p className="msg-error msg-small">{fill(rangeError, { max: num(REFERENCE_MAX_LENGTH, { digits: 0 }) })}</p>}
        </>
      )}
      <button className="panel-btn panel-btn-full" disabled={!ready} onClick={importIt}>
        {t(asReference ? 'data_exchange_reference_import' : 'data_exchange_import')}
      </button>
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={errors} />
      <MessageList items={notes} kind="warn" />
      <ReferenceAxisList />
      <VermEsnExport />
    </ExchangeSection>
  )
}
