import { useState } from 'react'
import LineForm from './CreateElementPanel/LineForm'
import CurvedLineForm from './CreateElementPanel/CurvedLineForm'
import ParallelLineForm from './CreateElementPanel/ParallelLineForm'
import ParallelTrackForm from './CreateElementPanel/ParallelTrackForm'
import BufferStopForm from './CreateElementPanel/BufferStopForm'
import PlatformPanel from './PlatformPanel'
import {
  CreateLineIcon, CreateArcIcon, CreateParallelIcon, CreateParallelTrackIcon, BufferStopIcon, NewPlatformIcon,
} from '../icons'
import { useI18n } from '../../locales/i18nContext'
import BackButton from './BackButton'

/**
 * Creating elements, buffer stops and platforms in one panel: the menu keeps
 * the three headings, separated by the gray line, and a tool click opens that
 * tool's form. The groups share the panel the way the switch panel's tools do
 * — one menu, one back. Connecting to a track end is in the splice panel.
 */
export default function CreatePanel() {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'straight') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('create_straight_line')}</h2>
      <LineForm onDone={() => setPage('menu')} />
    </>
  )

  if (page === 'curved') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('create_curved_line')}</h2>
      <CurvedLineForm onDone={() => setPage('menu')} />
    </>
  )

  if (page === 'parallel') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('create_parallel')}</h2>
      <ParallelLineForm onDone={() => setPage('menu')} />
    </>
  )

  if (page === 'parallel_track') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('create_parallel_track')}</h2>
      <ParallelTrackForm onDone={() => setPage('menu')} />
    </>
  )

  if (page === 'buffer_stop') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('buffer_stop_create')}</h2>
      <BufferStopForm onCommitted={back} />
    </>
  )

  if (page === 'platform') return (
    <>
      <BackButton onBack={back} />
      <PlatformPanel />
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
      <hr className="divider divider-wide" />
      <h2>{t('buffer_stop_section')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('buffer_stop')}>
          <BufferStopIcon />
          {t('buffer_stop_create')}
        </button>
      </div>
      <hr className="divider divider-wide" />
      <h2>{t('platform_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('platform')}>
          <NewPlatformIcon />
          {t('platform_new')}
        </button>
      </div>
    </>
  )
}
