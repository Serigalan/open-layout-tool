import { useEffect, useState } from 'react'
import { reverseTrackDirection } from '../../../storage'
import useTrackHover from '../../../hooks/useTrackHover'
import { FILTER_NONE, HIT_TOLERANCE, filterForTrack, mapIsLive } from '../../../utils/mapConstants'

export default function ChangeDirectionForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [selectedTrackId, setSelectedTrackId] = useState(null)

  useTrackHover(map, selectedTrackId === null ? 'select' : 'editing', 'select', project, true)

  useEffect(() => {
    const m = map?.current
    return () => {
      if (!mapIsLive(map, m)) return
      m.setFilter('tracks-selected-layer', FILTER_NONE)
      m.getCanvas().style.cursor = ''
    }
  }, [map])

  useEffect(() => {
    if (selectedTrackId !== null || !map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] }).filter(f => !f.properties.switchBranch)
      if (!features.length) return
      const { trackId } = features[0].properties
      // The whole track is reversed, so the whole track is highlighted.
      m.setFilter('tracks-selected-layer', filterForTrack(trackId))
      setSelectedTrackId(trackId)
    }

    m.on('click', onClick)
    return () => { m.off('click', onClick); m.getCanvas().style.cursor = '' }
  }, [selectedTrackId, map])

  const handleCommit = () => {
    if (!selectedTrackId) return
    reverseTrackDirection(project.id, selectedTrackId)
    onTrackSaved?.()
    onCommitted?.()
  }

  return (
    <>
      {!selectedTrackId
        ? <p>{t('edit_element_hint')}</p>
        : <p>{t('edit_element_selected')}</p>
      }
      {selectedTrackId ? (
        <>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 8 }} onClick={handleCommit}>
            {t('btn_commit')}
          </button>
          <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={onCommitted}>
            {t('btn_cancel')}
          </button>
        </>
      ) : (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={onCommitted}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
