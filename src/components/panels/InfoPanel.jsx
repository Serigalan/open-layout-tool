import {
  LayerIcon, PlaceIcon, ConnectElementIcon, ConnectSwitchIcon, ConnectCrossingIcon,
  SpliceElementIcon, OptimizeTrackIcon, EditElementIcon, ElevationIcon,
  PlatformIcon, DataExchangeIcon, PlanExportIcon, ExternalLinkIcon,
} from '../icons'
import { OSRD_URL } from '../../utils/osrdExport'

// Turn every literal "OSRD" in a translated string into a link to the OSRD demo.
function withOsrdLink(text) {
  const parts = text.split('OSRD')
  if (parts.length === 1) return text
  return parts.flatMap((part, i) =>
    i === 0 ? [part] : [
      <a key={i} className="info-panel-link" href={OSRD_URL} target="_blank" rel="noreferrer">
        OSRD<ExternalLinkIcon color="currentColor" size={11} />
      </a>,
      part,
    ]
  )
}

// One entry per panel reachable from the sidebar (in sidebar order).
// `title` reuses the panel's existing label key; `desc` is the new explanation.
const PANELS = [
  { Icon: LayerIcon,          title: 'tooltip_layers', desc: 'info_layers' },
  { Icon: PlaceIcon,          title: 'create_element', desc: 'info_places' },
  { Icon: ConnectElementIcon, title: 'connect_element', desc: 'info_connect' },
  { Icon: ConnectSwitchIcon,  title: 'connect_switch', desc: 'info_connect_switch' },
  { Icon: ConnectCrossingIcon, title: 'connect_crossing', desc: 'info_connect_crossing' },
  { Icon: SpliceElementIcon,  title: 'splice_element', desc: 'info_splice' },
  { Icon: OptimizeTrackIcon,  title: 'optimize_track', desc: 'info_optimize' },
  { Icon: EditElementIcon,    title: 'edit', desc: 'info_edit' },
  { Icon: ElevationIcon,      title: 'tooltip_elevation', desc: 'info_elevation' },
  { Icon: PlatformIcon,       title: 'platform_title', desc: 'info_platform' },
  { Icon: DataExchangeIcon,   title: 'data_exchange', desc: 'info_data' },
  { Icon: PlanExportIcon,     title: 'plan_title', desc: 'info_plan' },
]

export default function InfoPanel({ t }) {
  return (
    <>
      <h2>{t('info')}</h2>
      <p>{withOsrdLink(t('info_description'))}</p>
      <div className="info-panel-list">
        {PANELS.map((panel) => (
          <div className="info-panel-item" key={panel.title}>
            <div className="info-panel-icon"><panel.Icon /></div>
            <div className="info-panel-text">
              <h3 className="create-element-section">{t(panel.title)}</h3>
              <p>{withOsrdLink(t(panel.desc))}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
