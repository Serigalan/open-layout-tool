import { useState } from 'react'
import LineForm from './LineForm'
import CurvedLineForm from './CurvedLineForm'
import ParallelLineForm from './ParallelLineForm'
import ParallelTrackForm from './ParallelTrackForm'
import { BackIcon, CreateLineIcon, CreateArcIcon, CreateParallelIcon, CreateParallelTrackIcon } from '../../../components/icons'

export default function CreateElementPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')

  const backButton = (
    <button className="back-btn" onClick={() => setPage('menu')}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )

  if (page === 'straight') return (
    <>
      {backButton}
      <h2>{t('create_straight_line')}</h2>
      <LineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'curved') return (
    <>
      {backButton}
      <h2>{t('create_curved_line')}</h2>
      <CurvedLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel') return (
    <>
      {backButton}
      <h2>{t('create_parallel')}</h2>
      <ParallelLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel_track') return (
    <>
      {backButton}
      <h2>{t('create_parallel_track')}</h2>
      <ParallelTrackForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  return (
    <>
      <h2>{t('create_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('straight')}>
          <CreateLineIcon />
          {t('create_straight_line')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('curved')}>
          <CreateArcIcon />
          {t('create_curved_line')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('parallel')}>
          <CreateParallelIcon />
          {t('create_parallel')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('parallel_track')}>
          <CreateParallelTrackIcon />
          {t('create_parallel_track')}
        </button>
      </div>
    </>
  )
}
