import { useEffect, useState } from 'react'
import { deleteElement } from '../../../storage'
import { FILTER_NONE, HIT_TOLERANCE, filterForElement, mapIsLive } from '../../../utils/mapConstants'

export default function DeleteForm({ t, map, project, onTrackSaved }) {
  const [selectedTrackId, setSelectedTrackId] = useState(null)
  const [selectedElementIndex, setSelectedElementIndex] = useState(null)

  useEffect(() => {
    if (!map?.current) return
    const m = map.current
    m.getCanvas().style.cursor = 'pointer'

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] }).filter(f => !f.properties.switchBranch)
      if (features.length === 0) {
        setSelectedTrackId(null)
        setSelectedElementIndex(null)
        m.setFilter('tracks-selected-layer', FILTER_NONE)
        return
      }
      const { trackId, elementIndex } = features[0].properties
      const elIdx = Number(elementIndex)
      setSelectedTrackId(trackId)
      setSelectedElementIndex(elIdx)
      m.setFilter('tracks-selected-layer', filterForElement(trackId, elIdx))
    }

    m.on('click', onClick)
    return () => {
      m.off('click', onClick)
      if (!mapIsLive(map, m)) return
      m.getCanvas().style.cursor = ''
      m.setFilter('tracks-selected-layer', FILTER_NONE)
    }
  }, [map])

  const handleDelete = () => {
    if (selectedTrackId === null || selectedElementIndex === null || !project) return
    deleteElement(project.id, selectedTrackId, selectedElementIndex)
    setSelectedTrackId(null)
    setSelectedElementIndex(null)
    if (map?.current) map.current.setFilter('tracks-selected-layer', FILTER_NONE)
    onTrackSaved?.()
  }

  return (
    <>
      {selectedTrackId === null ? (
        <p>{t('edit_element_hint')}</p>
      ) : (
        <>
          <p>{t('edit_element_selected')}: <code>{selectedTrackId}[{selectedElementIndex}]</code></p>
          <button className="panel-btn panel-btn-full panel-btn-danger" onClick={handleDelete}>
            {t('edit_element_delete')}
          </button>
        </>
      )}
    </>
  )
}
