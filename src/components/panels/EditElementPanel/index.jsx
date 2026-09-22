import { useState } from 'react'
import { loadTracks } from '../../../storage'
import useTrackPick from '../../../hooks/useTrackPick'
import EditLengthForm from './EditLengthForm'
import EditPropertiesForm from './EditPropertiesForm'
import ChangeDirectionForm from './ChangeDirectionForm'
import DeleteForm from './DeleteForm'
import DeleteTrackForm from './DeleteTrackForm'
import DeleteSwitchForm from './DeleteSwitchForm'
import {
  BackIcon, EditLengthIcon, DeleteElementIcon, EditTracksIcon, EditPropertiesIcon,
  ChangeDirectionIcon, DeleteTrackIcon, DeleteSwitchIcon, PhysicsIcon, RegelwerkIcon,
} from '../../../components/icons'

export default function EditElementPanel({ t, map, project, trackTableId, onTrackSaved, onShowTrackTable, onShowPhysics, onShowRegelwerk, onCloseConstraints }) {
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
  useTrackPick(map, page === 'edit_tracks' && !trackTableId, ({ trackId, elementIndex }) => {
    const picked = loadTracks(project?.id ?? '').find(tr => tr.id === trackId)
    if (picked) onShowTrackTable?.(picked, elementIndex)
  }, { highlight: true })

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
      <EditLengthForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'edit_properties') return (
    <>
      {backButton()}
      <h2>{t('edit_track_properties')}</h2>
      <EditPropertiesForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete') return (
    <>
      {backButton()}
      <h2>{t('edit_element_delete')}</h2>
      <DeleteForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'edit_tracks') {
    const tracks = loadTracks(project?.id ?? '') ?? []
    return (
      <>
        {backButton(() => onShowTrackTable?.(null))}
        <h2>{t('edit_element_edit_tracks')}</h2>
        <p>{t('edit_tracks_hint')}</p>
        <div className="create-element-options">
          {tracks.map((track) => (
            <button
              key={track.id}
              className="create-element-btn"
              onClick={() => onShowTrackTable?.(track)}
            >
              {track.name || track.id.slice(0, 8)}
            </button>
          ))}
        </div>
      </>
    )
  }

  if (page === 'delete_track') return (
    <>
      {backButton()}
      <h2>{t('edit_track_delete')}</h2>
      <DeleteTrackForm t={t} map={map} project={project}
        onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'delete_switch') return (
    <>
      {backButton()}
      <h2>{t('switch_delete')}</h2>
      <DeleteSwitchForm t={t} map={map} project={project}
        onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} onCommitted={() => setPage('menu')} />
    </>
  )

  if (page === 'change_direction') return (
    <>
      {backButton()}
      <h2>{t('edit_change_direction')}</h2>
      <ChangeDirectionForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={() => setPage('menu')} />
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
        <button className="create-element-btn" onClick={() => goto('change_direction')}>
          <ChangeDirectionIcon />
          {t('edit_change_direction')}
        </button>
        <button className="create-element-btn" onClick={() => goto('delete_track')}>
          <DeleteTrackIcon />
          {t('edit_track_delete')}
        </button>
        <span className="create-element-section">{t('edit_switch')}</span>
        <button className="create-element-btn" onClick={() => goto('delete_switch')}>
          <DeleteSwitchIcon />
          {t('switch_delete')}
        </button>
      </div>
      {/* Not an object on the map but the rules every object is held to, so
          they sit apart from the menu above rather than among the tracks and
          switches — pinned to the bottom of the panel (`margin-top: auto` in
          a flex column that already reaches the bottom of the screen) rather
          than just the last two entries in a list that might scroll. Each
          opens its own popup, like the track editor: the tables are wider
          than the sidebar. */}
      <div className="edit-panel-footer">
        <button className="create-element-btn" onClick={() => onShowPhysics?.()}>
          <PhysicsIcon />
          {t('constraints_physics')}
        </button>
        <button className="create-element-btn" onClick={() => onShowRegelwerk?.()}>
          <RegelwerkIcon />
          {t('constraints_regelwerk')}
        </button>
      </div>
    </>
  )
}
