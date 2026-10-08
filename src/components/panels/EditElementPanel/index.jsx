import { useState } from 'react'
import { loadTracks } from '../../../storage'
import GroupedTrackList from '../GroupedTrackList'
import EditLengthForm from './EditLengthForm'
import EditPropertiesForm from './EditPropertiesForm'
import ChangeDirectionForm from './ChangeDirectionForm'
import DeleteForm from './DeleteForm'
import DeleteTrackForm from './DeleteTrackForm'
import DeleteSwitchForm from './DeleteSwitchForm'
import SwitchStatusForm from './SwitchStatusForm'
import AssignTracksForm from './AssignTracksForm'
import TrackVisibilityForm from './TrackVisibilityForm'
import RoutesForm from './RoutesForm'
import BufferStopForm from '../CreateElementPanel/BufferStopForm'
import {
  BackIcon, EditLengthIcon, DeleteElementIcon, EditTracksIcon, EditPropertiesIcon,
  ChangeDirectionIcon, AssignTracksIcon, DeleteTrackIcon, DeleteSwitchIcon,
  BufferStopIcon, TrackVisibilityIcon, RouteIcon,
} from '../../../components/icons'
import { useI18n } from '../../../locales/i18nContext'
import useMapPick from '../../../map/useMapPick'

export default function EditElementPanel({ trackTableId, onShowTrackTable, onCloseConstraints }) {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')

  // A constraints popup no longer covers this panel's own menu (it only fills
  // the map pane now), so its submenu buttons stay reachable while one is
  // open — and clicking any of them, unlike the two that open a popup, is how
  // it closes again.
  const goto = (next) => { onCloseConstraints?.(); setPage(next) }

  // Which track to edit is picked on the map as readily as from the list: while
  // the list is up and no table is open yet, a click on a track opens it, and
  // the track under the cursor is drawn on the hover layer so it is clear which
  // one that would be. Once a table is open it takes the clicks itself — it can
  // tell one of its rows from another track, which this cannot, and two
  // handlers on one click would only fight over it.
  useMapPick({ active: page === 'edit_tracks' && !trackTableId, hover: 'track', onPick: ({ trackId, elementIndex }) => {
    const picked = loadTracks().find(tr => tr.id === trackId)
    if (picked) onShowTrackTable?.(picked, elementIndex)
  } })

  const backButton = (onBack) => (
    <button className="back-btn" onClick={() => { setPage('menu'); onBack?.() }}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )

  if (page === 'edit_length') return (
    <>
      {backButton()}
      <h2>{t('edit_element_edit_length')}</h2>
      <EditLengthForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'edit_properties') return (
    <>
      {backButton()}
      <h2>{t('edit_track_properties')}</h2>
      <EditPropertiesForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'assign_tracks') return (
    <>
      {backButton()}
      <h2>{t('edit_assign_tracks')}</h2>
      <AssignTracksForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete') return (
    <>
      {backButton()}
      <h2>{t('edit_element_delete')}</h2>
      <DeleteForm onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'edit_tracks') {
    const tracks = loadTracks() ?? []
    return (
      <>
        {backButton(() => onShowTrackTable?.(null))}
        <h2>{t('edit_element_edit_tracks')}</h2>
        <p>{t('edit_tracks_hint')}</p>
        <GroupedTrackList tracks={tracks}
          isActive={(track) => track.id === trackTableId}
          onPick={(track) => onShowTrackTable?.(track)} />
      </>
    )
  }

  if (page === 'track_visibility') return (
    <>
      {backButton()}
      <h2>{t('track_visibility')}</h2>
      <TrackVisibilityForm />
    </>
  )

  if (page === 'routes') return (
    <>
      {backButton()}
      <h2>{t('routes')}</h2>
      <RoutesForm />
    </>
  )

  if (page === 'delete_track') return (
    <>
      {backButton()}
      <h2>{t('edit_track_delete')}</h2>
      <DeleteTrackForm
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete_switch') return (
    <>
      {backButton()}
      <h2>{t('switch_delete')}</h2>
      <DeleteSwitchForm
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'switch_status') return (
    <>
      {backButton()}
      <h2>{t('switch_status')}</h2>
      <SwitchStatusForm
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'buffer_stop') return (
    <>
      {backButton()}
      <h2>{t('buffer_stop_edit')}</h2>
      <BufferStopForm edit
        onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'change_direction') return (
    <>
      {backButton()}
      <h2>{t('edit_change_direction')}</h2>
      <ChangeDirectionForm onCommitted={() => setPage('menu')} />
    </>
  )

  return (
    <>
      <h2>{t('edit')}</h2>
      <div className="create-element-options">
        <span className="create-element-section">{t('edit_element')}</span>
        <button className="create-element-btn" onClick={() => goto('edit_length')}>
          <EditLengthIcon />
          {t('edit_element_edit_length')}
        </button>
        <button className="create-element-btn" onClick={() => goto('delete')}>
          <DeleteElementIcon />
          {t('edit_element_delete')}
        </button>
        <span className="create-element-section">{t('edit_track')}</span>
        <button className="create-element-btn" onClick={() => goto('edit_tracks')}>
          <EditTracksIcon />
          {t('edit_element_edit_tracks')}
        </button>
        <button className="create-element-btn" onClick={() => goto('edit_properties')}>
          <EditPropertiesIcon />
          {t('edit_track_properties')}
        </button>
        <button className="create-element-btn" onClick={() => goto('assign_tracks')}>
          <AssignTracksIcon />
          {t('edit_assign_tracks')}
        </button>
        <button className="create-element-btn" onClick={() => goto('change_direction')}>
          <ChangeDirectionIcon />
          {t('edit_change_direction')}
        </button>
        <button className="create-element-btn" onClick={() => goto('track_visibility')}>
          <TrackVisibilityIcon />
          {t('track_visibility')}
        </button>
        <button className="create-element-btn" onClick={() => goto('delete_track')}>
          <DeleteTrackIcon />
          {t('edit_track_delete')}
        </button>
        <span className="create-element-section">{t('edit_route')}</span>
        <button className="create-element-btn" onClick={() => goto('routes')}>
          <RouteIcon />
          {t('routes')}
        </button>
        <span className="create-element-section">{t('edit_switch')}</span>
        <button className="create-element-btn" onClick={() => goto('switch_status')}>
          <EditPropertiesIcon />
          {t('switch_status')}
        </button>
        <button className="create-element-btn" onClick={() => goto('delete_switch')}>
          <DeleteSwitchIcon />
          {t('switch_delete')}
        </button>
        <span className="create-element-section">{t('edit_track_end')}</span>
        <button className="create-element-btn" onClick={() => goto('buffer_stop')}>
          <BufferStopIcon />
          {t('buffer_stop_edit')}
        </button>
      </div>
    </>
  )
}
