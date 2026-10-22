import { useMemo, useState } from 'react'
import { commitImport } from '../../../storage'
import { HEIGHT_DATUMS, heightDatumLabel } from '../../../utils/track'
import {
  batchReferences, buildVermEsnBatch, gradientHeightCode, readKmLines, readVermEsnArchive,
} from '../../../utils/exchange'
import { readFileBuffer } from '../../../utils/common'
import { REFERENCE_MAX_LENGTH, buildReferenceAxis, referenceStretches } from '../../../utils/survey'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import InfoTip from '../../form/InfoTip'

/**
 * Verm.ESN as a batch: every TRA of a zip as a track, each with the GRA of the
 * same file name as its heights — in the plane chosen above for the section
 * (`epsg`) and the one height datum chosen here, both once for all files.
 * TRAs named like a kilometrage line (`6340S`) are lines, not tracks: a
 * gradient may be stationed along one of them, which is found per track by how
 * well its ends meet the track's and can be changed before the import.
 * Each track can come in a second time as a reference axis (Bestandsachse,
 * Paket V) — the same axis and gradient as points, the one to compare the
 * edited track with; one longer than REFERENCE_MAX_LENGTH as several, cut
 * where referenceStretches says.
 */
export default function VermEsnBatch({ epsg }) {
  const { t, fill, num } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const [heightEpsg, setHeightEpsg] = useState('')   // chosen, never preset
  const [batch, setBatch] = useState(null)           // { name, pairs, kmLines, orphans, duplicates, codes }
  const [chosen, setChosen] = useState(() => new Map())   // track name → km line name, '' for the track
  const [asReference, setAsReference] = useState(false)   // each track also as a reference axis
  const [errors, setErrors] = useState([])
  const [notes, setNotes] = useState([])
  const [done, setDone] = useState(null)

  const readZip = async (file) => {
    setDone(null); setErrors([]); setNotes([])
    try {
      const archive = readVermEsnArchive(await readFileBuffer(file))
      if (!archive.pairs.length) {
        setBatch(null)
        setErrors([t('data_exchange_vermesn_batch_empty')])
        return
      }
      const codes = [...new Set(archive.pairs.filter(p => p.gra).map(p => gradientHeightCode(p.gra, p.graFile)).filter(Boolean))]
      setChosen(new Map())
      setBatch({ name: file.name, ...archive, codes })
    } catch (err) {
      console.error('Verm.ESN batch error:', err)
      setBatch(null)
      setErrors([t('data_exchange_vermesn_batch_unreadable')])
    }
  }

  const withGra = batch?.pairs.filter(p => p.gra).length ?? 0
  // The kilometrage lines in the plane chosen, and per track what its
  // gradient can be stationed along, best first.
  const km = useMemo(() => (batch ? readKmLines(batch.kmLines, epsg) : { axes: [], errors: [] }), [batch, epsg])
  const references = useMemo(() => (batch && km.axes.length ? batchReferences(batch.pairs, km.axes, epsg) : new Map()),
    [batch, km, epsg])
  const refOf = (name) => (chosen.has(name) ? chosen.get(name) : references.get(name)?.[0] ?? '') || ''
  const ready = !!project && !!batch && (!withGra || !!heightEpsg)

  const importIt = () => {
    if (!ready) return
    const { tracks: built, kmLines, files } = buildVermEsnBatch(batch.pairs, {
      epsg: Number(epsg), heightEpsg: withGra ? Number(heightEpsg) : null,
      takenNames: tracks.map(tr => tr.name).filter(Boolean),
      kmAxes: km.axes, references: new Map([...references.keys()].map(name => [name, refOf(name) || null])),
    })
    const axes = []
    const axisNotes = []
    for (const f of asReference ? files.filter(f => f.imported) : []) {
      const track = built.find(tr => tr.id === f.trackId)
      const stretches = referenceStretches(f.startStation, f.startStation + f.length)
      for (const { from, to } of stretches) {
        axes.push(buildReferenceAxis({
          name: stretches.length > 1 ? `${f.name} ${num(from, { digits: 0 })}–${num(to, { digits: 0 })}` : f.name,
          epsg: Number(epsg), elements: track.elements, startStation: f.startStation, from, to,
          gradient: f.gradient, heightEpsg: f.gradient ? Number(heightEpsg) : null, tra: f.traFile, gra: f.graFile,
        }))
      }
      if (stretches.length > 1) {
        axisNotes.push(fill('data_exchange_vermesn_batch_reference_split', {
          name: f.name, n: stretches.length, max: num(REFERENCE_MAX_LENGTH, { digits: 0 }),
        }))
      }
    }
    if (built.length) commitImport({ addTracks: built, addKmLines: kmLines, addReferenceAxes: axes })
    const failed = files.filter(f => !f.imported)
    const counts = { tracks: built.length, heights: files.filter(f => f.heights > 0).length, axes: axes.length }
    setDone(built.length
      ? fill(asReference ? 'data_exchange_vermesn_batch_done_axes' : 'data_exchange_vermesn_batch_done', counts)
      : null)
    setErrors(failed.map(f => fill('data_exchange_vermesn_batch_refused', {
      file: f.traFile, reason: f.errors.length ? f.errors.join('; ') : t('data_exchange_vermesn_tra_empty'),
    })))
    setNotes([
      ...(kmLines.length ? [fill('data_exchange_vermesn_km_lines', { lines: kmLines.map(l => l.lineNumber).join(', ') })] : []),
      ...files.flatMap(f => f.notes.map(note => `${f.graFile}: ${note}`)),
      ...axisNotes,
    ])
    setBatch(null)
  }

  return (
    <>
      <hr className="divider" />
      <span className="create-element-section">
        {t('data_exchange_vermesn_batch')}<InfoTip text={t('data_exchange_vermesn_batch_desc')} />
      </span>
      <div className="form-field">
        <label>{t('data_exchange_vermesn_batch_height')}</label>
        <select className="settings-select" value={heightEpsg} onChange={e => setHeightEpsg(e.target.value)}>
          <option value="">{t('pointcloud_choose')}</option>
          {HEIGHT_DATUMS.map(d => <option key={d.epsg} value={d.epsg}>{heightDatumLabel(d.epsg)}</option>)}
        </select>
        {batch?.codes.length > 0 && (
          <span className="msg-hint msg-small">{fill('data_exchange_vermesn_batch_height_codes', { codes: batch.codes.join(', ') })}</span>
        )}
      </div>
      {batch ? (
        <div className="form-field">
          <div className="row">
            <div className="grow">
              <div className="file-slot-name text-ellipsis" title={batch.name}>{batch.name}</div>
              <div className="msg-hint msg-small">
                {fill('data_exchange_vermesn_batch_loaded', { tracks: batch.pairs.length, gradients: withGra })}
              </div>
              {km.axes.length > 0 && (
                <div className="msg-hint msg-small">
                  {fill('data_exchange_vermesn_batch_km', { names: km.axes.map(a => a.name).join(', ') })}
                </div>
              )}
            </div>
            <button className="panel-btn" onClick={() => setBatch(null)}
              title={t('data_exchange_vermesn_batch_remove')} aria-label={t('data_exchange_vermesn_batch_remove')}>✕</button>
          </div>
        </div>
      ) : (
        <FilePickButton accept=".zip,application/zip" disabled={!project} onFile={readZip}>
          {t('data_exchange_vermesn_batch_pick')}
        </FilePickButton>
      )}
      {batch && (
        <MessageList kind="warn" items={[
          ...(batch.orphans.length ? [fill('data_exchange_vermesn_batch_orphans', { files: batch.orphans.join(', ') })] : []),
          ...(batch.duplicates.length ? [fill('data_exchange_vermesn_batch_duplicates', { files: batch.duplicates.join(', ') })] : []),
          ...(withGra && !heightEpsg ? [t('data_exchange_vermesn_batch_height_missing')] : []),
          ...km.errors.map(e => fill('data_exchange_vermesn_batch_km_refused', {
            file: e.file, reason: e.errors.length ? e.errors.join('; ') : t('data_exchange_vermesn_tra_empty'),
          })),
        ]} />
      )}
      {references.size > 0 && (
        <div className="form-field">
          <label>{t('data_exchange_vermesn_reference')}<InfoTip text={t('data_exchange_vermesn_reference_hint')} /></label>
          <div className="stack-tight">
            {[...references].map(([name, refs]) => (
              <div key={name} className="row vermesn-ref-row">
                <span className="grow text-ellipsis" title={name}>{name}</span>
                <select className="settings-select" value={refOf(name)} aria-label={name}
                  onChange={e => setChosen(prev => new Map(prev).set(name, e.target.value))}>
                  {refs.map(ref => (
                    <option key={ref ?? ''} value={ref ?? ''}>
                      {ref ?? t('data_exchange_vermesn_reference_track')}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
      <label className="transition-curve-row">
        <input type="checkbox" checked={asReference} onChange={e => setAsReference(e.target.checked)} />
        <span>{t('data_exchange_vermesn_batch_reference')}</span>
        <InfoTip text={t('data_exchange_vermesn_batch_reference_hint')} />
      </label>
      <button className="panel-btn panel-btn-full mt-6" disabled={!ready} onClick={importIt}>
        {batch ? fill('data_exchange_vermesn_batch_import_n', { n: batch.pairs.length }) : t('data_exchange_import')}
      </button>
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={errors} />
      <MessageList items={notes} kind="warn" />
    </>
  )
}
