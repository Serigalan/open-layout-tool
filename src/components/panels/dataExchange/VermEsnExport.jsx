import { useState } from 'react'
import { exportVermEsn } from '../../../utils/vermEsnExport'
import { trackLabel } from '../../../utils/trackModel'
import { downloadBlob } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import useMapPick from '../../../map/useMapPick'
import MessageList from '../../form/MessageList'

/**
 * The project's tracks as Verm.ESN files — the tracks picked on the map, or
 * all of them where none is: one zip with a TRA per track, a GRA where it has
 * heights, and a text naming plane and height datum, which the files do not.
 */
export default function VermEsnExport() {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [done, setDone] = useState(null)
  const [skipped, setSkipped] = useState([])

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  useMapPick({ active: selecting, hover: 'element', onPick: ({ trackId }) => toggle(trackId) })

  const selected = tracks.filter(tr => selectedIds.has(tr.id))

  const exportIt = () => {
    const chosen = selected.length ? selected : tracks
    const { zip, files, skipped: none } = exportVermEsn(chosen, { title: project.title })
    if (files.length) {
      downloadBlob(new Blob([zip], { type: 'application/zip' }), `${project.title}_VermESN.zip`)
    }
    setDone(files.length ? fill('data_exchange_vermesn_export_done', {
      tracks: files.length, gradients: files.filter(f => f.gra).length,
    }) : null)
    setSkipped(none.length ? [fill('data_exchange_vermesn_export_skipped', { names: none.join(', ') })] : [])
  }

  return (
    <>
      <hr className="divider" />
      <p className="msg-hint">{t('data_exchange_vermesn_export_desc')}</p>
      <div className="row">
        <button className={`panel-btn panel-btn-full grow ${selecting ? 'active' : ''}`} disabled={!project}
          onClick={() => setSelecting(s => !s)}>
          {t('data_exchange_select')}
        </button>
        <button className="panel-btn panel-btn-full grow" disabled={!project || !tracks.length} onClick={exportIt}>
          {selected.length
            ? fill('data_exchange_vermesn_export_n', { n: selected.length })
            : t('data_exchange_vermesn_export_all')}
        </button>
      </div>
      {selected.length > 0 && (
        <div className="mt-4 stack-tight">
          {selected.map(tr => (
            <div key={tr.id} className="chip">
              <span>{trackLabel(tr)}</span>
              <button type="button" className="chip-remove" aria-label={t('btn_remove')} onClick={() => toggle(tr.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      {done && <p className="msg-ok msg-small">{done}</p>}
      <MessageList items={skipped} kind="warn" />
    </>
  )
}
