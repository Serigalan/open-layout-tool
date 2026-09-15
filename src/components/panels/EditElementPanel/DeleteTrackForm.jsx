import { useEffect, useState } from 'react'
import { deleteTrack, loadTracks, switchesOnTrack } from '../../../storage'
import useTrackHover from '../../../hooks/useTrackHover'
import ConfirmModal from '../../ConfirmModal'
import { FILTER_NONE, HIT_TOLERANCE, filterForTrack, mapIsLive } from '../../../utils/mapConstants'

export default function DeleteTrackForm({ t, map, project, onTrackSaved, onCommitted }) {
  // { id, name, elements, switchNames } – switch branches are not offered: their
  // geometry belongs to a switch and goes with it, not on its own.
  const [selected, setSelected]     = useState(null)
  const [confirming, setConfirming] = useState(false)

  useTrackHover(map, selected === null ? 'select' : 'editing', 'select', project, true)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter('tracks-selected-layer', FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  // Click to pick the track — the whole track is highlighted, since the whole
  // track is what gets deleted.
  useEffect(() => {
    if (selected !== null || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] }).filter(f => !f.properties.switchBranch)
      if (features.length === 0) return
      const { trackId } = features[0].properties
      const track = loadTracks(project.id).find(tr => tr.id === trackId)
      if (!track) return

      m.setFilter('tracks-selected-layer', filterForTrack(trackId))
      setSelected({
        id:          trackId,
        name:        track.name || trackId.slice(0, 8),
        elements:    (track.elements ?? []).length,
        switchNames: switchesOnTrack(project.id, trackId).map((sw, i) => sw.name || `#${i + 1}`),
      })
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selected, map, project.id])

  const handleDelete = () => {
    deleteTrack(project.id, selected.id)
    setConfirming(false)
    setSelected(null)
    map?.current?.setFilter('tracks-selected-layer', FILTER_NONE)
    onTrackSaved?.()
  }

  const fill = (key, values) =>
    Object.entries(values).reduce((msg, [k, v]) => msg.replace(`{{${k}}}`, v), t(key))

  return (
    <>
      {!selected ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <p>{fill('edit_track_delete_selected', { name: selected.name, elements: selected.elements })}</p>
          {selected.switchNames.length > 0 && (
            <p className="form-error">{fill('edit_track_delete_switches', { names: selected.switchNames.join(', ') })}</p>
          )}
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={() => setConfirming(true)}>
            {t('edit_track_delete')}
          </button>
        </>
      )}
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
        {t('btn_cancel')}
      </button>

      {confirming && (
        <ConfirmModal
          t={t}
          message={fill('edit_track_delete_confirm', { name: selected.name, elements: selected.elements })}
          onConfirm={handleDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
