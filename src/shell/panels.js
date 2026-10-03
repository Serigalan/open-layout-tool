import { lazy } from 'react'
import { LayerIcon, TopologyIcon, PlaceIcon, SettingsIcon, InfoIcon, DataExchangeIcon, EditElementIcon, ConnectSwitchIcon, SpliceElementIcon, StationIcon, PlanExportIcon, ElevationIcon } from '../components/icons'

// Each panel is its own chunk (R9.1), loaded the first time it is opened.
const LayersPanel = lazy(() => import('../components/panels/LayersPanel'))
const TopologyPanel = lazy(() => import('../components/panels/TopologyPanel'))
const CreateConnectPanel = lazy(() => import('../components/panels/CreateConnectPanel'))
const ConnectSwitchPanel = lazy(() => import('../components/panels/ConnectSwitchPanel'))
const SpliceOptimizePanel = lazy(() => import('../components/panels/SpliceOptimizePanel'))
const ElevationPanel = lazy(() => import('../components/panels/ElevationPanel'))
const PlatformCrossSectionPanel = lazy(() => import('../components/panels/PlatformCrossSectionPanel'))
const EditElementPanel = lazy(() => import('../components/panels/EditElementPanel'))
const SettingsPanel = lazy(() => import('../components/panels/SettingsPanel'))
const InfoPanel = lazy(() => import('../components/panels/InfoPanel'))
const DataExchangePanel = lazy(() => import('../components/panels/DataExchangePanel'))
const PlanExportPanel = lazy(() => import('../components/panels/PlanExportPanel'))

/**
 * The panels of the map view (R2.3), in the order the sidebar shows them.
 * The sidebar and the panel pane are both made from this list.
 *
 *   id          what the shell calls the panel
 *   icon        its sidebar symbol, titleKey its name
 *   place       'top' or 'bottom' of the sidebar
 *   Component   the panel itself
 *   props(s)    what it takes from the shell `s` (state and handlers in App)
 *   onEnter(s)  runs when the panel is opened, onLeave(s) when it is left
 *   overlay     the map overlay that belongs to the panel and closes with it
 */
export const PANELS = [
  {
    id: 'layers', icon: LayerIcon, titleKey: 'tooltip_layers', place: 'top', Component: LayersPanel,
    props: (s) => ({
      activeBasemap: s.activeBasemap, onBasemapChange: s.setBasemap,
      kmOverlays: s.kmOverlays, onKmOverlayChange: s.setKmOverlay, kmLinesError: s.kmLinesError,
    }),
  },
  {
    id: 'topology', icon: TopologyIcon, titleKey: 'topology_title', place: 'top', Component: TopologyPanel,
    overlay: 'topologyGraph',
    props: (s) => ({
      selection: s.topologySelection, onSelect: s.setTopologySelection,
      graphOpen: s.overlay?.kind === 'topologyGraph',
      onShowGraph: (on) => (on ? s.openOverlay({ kind: 'topologyGraph' }) : s.closeOverlay('topologyGraph')),
    }),
    // The view is drawn over a pale Liberty, and its diagram comes up with it
    // every time; whatever basemap was up comes back when it is left, and the
    // selection belongs to the view and goes with it.
    onEnter: (s) => {
      if (s.activeBasemap !== 'liberty') {
        s.basemapBeforeTopology.current = s.activeBasemap
        s.setBasemap('liberty')
      }
      s.openOverlay({ kind: 'topologyGraph' })
    },
    onLeave: (s) => {
      s.setTopologySelection(null)
      if (s.basemapBeforeTopology.current) {
        s.setBasemap(s.basemapBeforeTopology.current)
        s.basemapBeforeTopology.current = null
      }
    },
  },
  { id: 'places', icon: PlaceIcon, titleKey: 'create_element', place: 'top', Component: CreateConnectPanel },
  { id: 'connect_switch', icon: ConnectSwitchIcon, titleKey: 'connect_switch', place: 'top', Component: ConnectSwitchPanel },
  {
    id: 'splice', icon: SpliceElementIcon, titleKey: 'splice_element', place: 'top', Component: SpliceOptimizePanel,
    props: (s) => ({ onShowRegelwerk: s.showRegelwerk }),
  },
  {
    id: 'elevation', icon: ElevationIcon, titleKey: 'tooltip_elevation', place: 'top', Component: ElevationPanel,
    overlay: 'profile',
    props: (s) => ({
      profileTrackId: s.overlay?.kind === 'profile' ? s.overlay.trackId : null,
      onShowProfile: (trackId) => (trackId ? s.openOverlay({ kind: 'profile', trackId }) : s.closeOverlay('profile')),
    }),
  },
  {
    id: 'platform', icon: StationIcon, titleKey: 'platform_cross_section', place: 'top', Component: PlatformCrossSectionPanel,
    overlay: 'crossSection',
    props: (s) => ({
      crossSectionAt: s.overlay?.kind === 'crossSection' ? s.overlay.at : null,
      onShowCrossSection: (at) => (at ? s.openOverlay({ kind: 'crossSection', at }) : s.closeOverlay('crossSection')),
    }),
  },
  {
    id: 'edit', icon: EditElementIcon, titleKey: 'edit', place: 'top', Component: EditElementPanel,
    overlay: 'trackTable',
    props: (s) => ({
      trackTableId: s.overlay?.kind === 'trackTable' ? s.overlay.track.id : undefined,
      onShowTrackTable: s.showTrackTable,
      onShowPhysics: s.showPhysics, onShowRegelwerk: s.showRegelwerk, onCloseConstraints: s.closePopup,
    }),
  },
  {
    id: 'data', icon: DataExchangeIcon, titleKey: 'data_exchange', place: 'top', Component: DataExchangePanel,
    props: (s) => ({ onShowCompare: s.setCompare }),
  },
  {
    id: 'plan', icon: PlanExportIcon, titleKey: 'plan_title', place: 'top', Component: PlanExportPanel,
    overlay: 'planPreview',
    props: (s) => ({
      onShowPlanPreview: (preview) => (preview ? s.openOverlay({ kind: 'planPreview', ...preview }) : s.closeOverlay('planPreview')),
    }),
  },
  { id: 'info', icon: InfoIcon, titleKey: 'info', place: 'bottom', Component: InfoPanel },
  {
    id: 'settings', icon: SettingsIcon, titleKey: 'settings', place: 'bottom', Component: SettingsPanel,
    props: (s) => ({ color: s.color, onColorChange: s.setColor }),
  },
]

export const panelById = (id) => PANELS.find(p => p.id === id) ?? null
