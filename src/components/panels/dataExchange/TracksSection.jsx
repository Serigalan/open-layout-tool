import { useState } from 'react'
import { loadSwitches, loadTracks, commitImport, updateTrack } from '../../../storage'
import { rebuildCoords, trackLabel } from '../../../utils/trackModel'
import { parseTracksPayload, PayloadError } from '../../../utils/persistenceUtils'
import { reconstructElements } from '../../../utils/elementReconstruct'
import { downloadJSON, readFileText } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useProject, useTracks } from '../../../hooks/useStore'
import useMapPick from '../../../map/useMapPick'
import ConfirmModal from '../../ConfirmModal'
import FilePickButton from '../../form/FilePickButton'
import ExchangeSection from './ExchangeSection'

/** Display geometry rebuilt from the element scalars (native CRS per element). */
function reconstructTrack(track) {
  const elements = reconstructElements(track.elements, track.epsg)
  return { ...track, elements, coordinates: rebuildCoords(elements) }
}

/** Without geometry: what a track file carries is the element scalars. */
const forFile = ({ elements, coordinates: _c, ...track }) => ({
  ...track,
  elements: (elements ?? []).map(({ geometry: _g, renderCoords: _rc, ...rest }) => rest),
})

/**
 * Single tracks in and out: tracks picked on the map go into a file, and a
 * file's tracks come into the project — one whose id is already there is
 * asked about, one at a time.
 */
export default function TracksSection() {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = useTracks()
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [conflicts, setConflicts] = useState([])   // [{ existing, imported }]
  const [error, setError] = useState(null)

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  useMapPick({ active: selecting, hover: 'element', onPick: ({ trackId }) => toggle(trackId) })

  const selected = tracks.filter(tr => selectedIds.has(tr.id))

  const importFile = async (file) => {
    setError(null)
    let incoming
    try {
      const switchIds = new Set(loadSwitches().map(sw => sw.switchId))
      incoming = parseTracksPayload(JSON.parse(await readFileText(file)), { switchIds })
    } catch (err) {
      setError(t(`tracks_import_err_${err instanceof PayloadError ? err.code : 'invalid_payload'}`))
      return
    }
    const existing = loadTracks()
    const byId = new Map(existing.map(tr => [tr.id, tr]))
    const fresh = incoming.filter(tr => !byId.has(tr.id))
    if (fresh.length) commitImport({ addTracks: fresh.map(reconstructTrack) })
    setConflicts(incoming.filter(tr => byId.has(tr.id)).map(imported => ({ imported, existing: byId.get(imported.id) })))
  }

  const resolve = (keepImported) => {
    const [current, ...rest] = conflicts
    if (keepImported) updateTrack(reconstructTrack(current.imported))
    setConflicts(rest)
  }

  return (
    <ExchangeSection title={t('data_exchange_tracks')}>
      <FilePickButton accept=".json,application/json" disabled={!project} onFile={importFile}>
        {t('data_exchange_import')}
      </FilePickButton>
      {error && <p className="msg-error">{error}</p>}
      <hr className="divider" />
      <div className="row">
        <button className={`panel-btn panel-btn-full grow ${selecting ? 'active' : ''}`}
          onClick={() => setSelecting(s => !s)}>
          {t('data_exchange_select')}
        </button>
        <button className="panel-btn panel-btn-full grow" disabled={!selected.length}
          onClick={() => downloadJSON(selected.map(forFile), project ? `${project.title}_tracks.json` : 'tracks.json')}>
          {t('data_exchange_export')}
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
      {/* Escape keeps what is there — the one answer that changes nothing. */}
      {conflicts.length > 0 && (
        <ConfirmModal danger={false}
          message={fill('import_track_conflict_message', { name: trackLabel(conflicts[0].existing) })}
          cancelLabel={t('import_keep_existing')} onCancel={() => resolve(false)}
          confirmLabel={t('import_keep_imported')} onConfirm={() => resolve(true)} />
      )}
    </ExchangeSection>
  )
}
