import { useState } from 'react'
import LineForm from './CreateElementPanel/LineForm'
import CurvedLineForm from './CreateElementPanel/CurvedLineForm'
import ParallelLineForm from './CreateElementPanel/ParallelLineForm'
import ParallelTrackForm from './CreateElementPanel/ParallelTrackForm'
import ConnectStraightForm from './ConnectElementPanel/ConnectStraightForm'
import ConnectCurvedForm from './ConnectElementPanel/ConnectCurvedForm'
import {
  BackIcon, CreateLineIcon, CreateArcIcon, CreateParallelIcon, CreateParallelTrackIcon,
  ConnectStraightIcon, ConnectCurvedIcon,
} from '../icons'

// The gray line between the two tool groups, the same separator the layers
// panel draws between its basemap groups.
const SEPARATOR = { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' }

function BackButton({ t, onBack }) {
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}

/**
 * Creating and connecting in one panel: the menu keeps both headings, separated
 * by the gray line, and a tool click opens that tool's form. The two groups
 * share the panel the way the switch panel's tools do — one menu, one back.
 */
export default function CreateConnectPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'straight') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('create_straight_line')}</h2>
      <LineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'curved') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('create_curved_line')}</h2>
      <CurvedLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('create_parallel')}</h2>
      <ParallelLineForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'parallel_track') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('create_parallel_track')}</h2>
      <ParallelTrackForm t={t} map={map} project={project} onTrackSaved={() => { onTrackSaved?.(); setPage('menu') }} />
    </>
  )

  if (page === 'connect_straight') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('connect_straight')}</h2>
      <ConnectStraightForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={back} />
    </>
  )

  if (page === 'connect_curved') return (
    <>
      <BackButton t={t} onBack={back} />
      <h2>{t('connect_curved')}</h2>
      <ConnectCurvedForm t={t} map={map} project={project} onTrackSaved={onTrackSaved} onCommitted={back} />
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
      <hr style={SEPARATOR} />
      <h2>{t('connect_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('connect_straight')}>
          <ConnectStraightIcon />
          {t('connect_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('connect_curved')}>
          <ConnectCurvedIcon />
          {t('connect_curved')}
        </button>
      </div>
    </>
  )
}
