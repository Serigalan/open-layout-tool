import { useState } from 'react'
import { commitImport } from '../../../storage'
import { HEIGHT_DATUMS, heightDatumLabel } from '../../../utils/track'
import { buildVermEsnBatch, gradientHeightCode, readVermEsnArchive } from '../../../utils/exchange'
import { readFileBuffer } from '../../../utils/common'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import FilePickButton from '../../form/FilePickButton'
import MessageList from '../../form/MessageList'
import InfoTip from '../../form/InfoTip'

/**
 * Verm.ESN as a batch: every TRA of a zip as a track, each with the GRA of the
 * same file name as its heights — in the plane chosen above for the section
 * (`epsg`) and the one height datum chosen here, both once for all files.
 */
export default function VermEsnBatch({ epsg }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const [heightEpsg, setHeightEpsg] = useState('')   // chosen, never preset
  const [batch, setBatch] = useState(null)           // { name, pairs, orphans, duplicates, codes }
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
      setBatch({ name: file.name, ...archive, codes })
    } catch (err) {
      console.error('Verm.ESN batch error:', err)
      setBatch(null)
      setErrors([t('data_exchange_vermesn_batch_unreadable')])
    }
  }

  const withGra = batch?.pairs.filter(p => p.gra).length ?? 0
  const ready = !!project && !!batch && (!withGra || !!heightEpsg)

  const importIt = () => {
    if (!ready) return
    const { tracks: built, files } = buildVermEsnBatch(batch.pairs, {
      epsg: Number(epsg), heightEpsg: withGra ? Number(heightEpsg) : null,
      takenNames: tracks.map(tr => tr.name).filter(Boolean),
    })
    if (built.length) commitImport({ addTracks: built })
    const failed = files.filter(f => !f.imported)
    setDone(built.length ? fill('data_exchange_vermesn_batch_done', {
      tracks: built.length, heights: files.filter(f => f.heights > 0).length,
    }) : null)
    setErrors(failed.map(f => fill('data_exchange_vermesn_batch_refused', {
      file: f.traFile, reason: f.errors.length ? f.errors.join('; ') : t('data_exchange_vermesn_tra_empty'),
    })))
    setNotes(files.flatMap(f => f.notes.map(note => `${f.graFile}: ${note}`)))
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
        ]} />
      )}
      <button className="panel-btn panel-btn-full mt-6" disabled={!ready} onClick={importIt}>
        {batch ? fill('data_exchange_vermesn_batch_import_n', { n: batch.pairs.length }) : t('data_exchange_import')}
      </button>
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={errors} />
      <MessageList items={notes} kind="warn" />
    </>
  )
}
