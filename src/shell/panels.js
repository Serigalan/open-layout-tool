import { lazy } from 'react'
import { LayerIcon, TopologyIcon, PlaceIcon, SettingsIcon, InfoIcon, DataExchangeIcon, EditElementIcon, ConnectSwitchIcon, SpliceElementIcon, CrossSectionIcon, PlanExportIcon, ElevationIcon, CheckIcon } from '../components/icons'

// Each panel is its own chunk (R9.1), loaded the first time it is opened.
const LayersPanel = lazy(() => import('../components/panels/LayersPanel'))
const TopologyPanel = lazy(() => import('../components/panels/TopologyPanel'))
const CreatePanel = lazy(() => import('../components/panels/CreatePanel'))
const ConnectSwitchPanel = lazy(() => import('../components/panels/ConnectSwitchPanel'))
const SpliceConnectPanel = lazy(() => import('../components/panels/SpliceConnectPanel'))
const ElevationPanel = lazy(() => import('../components/panels/ElevationPanel'))
const CrossSectionsPanel = lazy(() => import('../components/panels/CrossSectionsPanel'))
const EditElementPanel = lazy(() => import('../components/panels/EditElementPanel'))
const SettingsPanel = lazy(() => import('../components/panels/SettingsPanel'))
const InfoPanel = lazy(() => import('../components/panels/InfoPanel'))
const DataExchangePanel = lazy(() => import('../components/panels/DataExchangePanel'))
const PlanExportPanel = lazy(() => import('../components/panels/PlanExportPanel'))
const CheckPanel = lazy(() => import('../components/panels/CheckPanel'))

/**
 * The panels of the map view (R2.3), in the order the sidebar shows them.
 * The sidebar and the panel pane are both made from this list.
 *
 * In the order of the work (R10.7): the view on the map; laying out the
 * alignment — create (platforms too), splice, the switches; editing; the
 * heights; cross sections; checking against the rules; exchange; the plan. The
 * sidebar draws a line where the `group` changes.
 *
 *   id          what the shell calls the panel
 *   icon        its sidebar symbol, titleKey its name
 *   group       the work step it belongs to
 *   place       'top' or 'bottom' of the sidebar
 *   Component   the panel itself
 *   props(s)    what it takes from the shell `s` (state and handlers in App)
 *   onEnter(s)  runs when the panel is opened, onLeave(s) when it is left
 *   overlay     the map overlay that belongs to the panel and closes with it
 */
export const PANELS = [
  {
    id: 'layers', group: 'view', icon: LayerIcon, titleKey: 'tooltip_layers', place: 'top', Component: LayersPanel,
    props: (s) => ({
      activeBasemap: s.activeBasemap, onBasemapChange: s.setBasemap,
      kmOverlays: s.kmOverlays, onKmOverlayChange: s.setKmOverlay, kmLinesError: s.kmLinesError,
    }),
  },
  {
    id: 'topology', group: 'view', icon: TopologyIcon, titleKey: 'topology_title', place: 'top', Component: TopologyPanel,
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
        s.setBasemapBeforeTopology(s.activeBasemap)
        s.setBasemap('liberty')
      }
      s.openOverlay({ kind: 'topologyGraph' })
    },
    onLeave: (s) => {
      s.setTopologySelection(null)
      if (s.basemapBeforeTopology) {
        s.setBasemap(s.basemapBeforeTopology)
        s.setBasemapBeforeTopology(null)
      }
    },
  },
  { id: 'places', group: 'design', icon: PlaceIcon, titleKey: 'create_element', place: 'top', Component: CreatePanel },
  { id: 'splice', group: 'design', icon: SpliceElementIcon, titleKey: 'splice_element', place: 'top', Component: SpliceConnectPanel },
  { id: 'connect_switch', group: 'design', icon: ConnectSwitchIcon, titleKey: 'connect_switch', place: 'top', Component: ConnectSwitchPanel },
  {
    id: 'edit', group: 'edit', icon: EditElementIcon, titleKey: 'edit', place: 'top', Component: EditElementPanel,
    overlay: 'trackTable',
    props: (s) => ({
      trackTableId: s.overlay?.kind === 'trackTable' ? s.overlay.track.id : undefined,
      onShowTrackTable: s.showTrackTable,
      onCloseConstraints: s.closePopup,
    }),
  },
  {
    id: 'elevation', group: 'heights', icon: ElevationIcon, titleKey: 'tooltip_elevation', place: 'top', Component: ElevationPanel,
    overlay: 'profile',
    props: (s) => ({
      profileTrackId: s.overlay?.kind === 'profile' && !s.overlay.routeId ? s.overlay.trackId : null,
      profileRouteId: s.overlay?.kind === 'profile' ? s.overlay.routeId ?? null : null,
      onShowProfile: (trackId) => (trackId ? s.openOverlay({ kind: 'profile', trackId }) : s.closeOverlay('profile')),
      onShowRouteProfile: (routeId) => (routeId ? s.openOverlay({ kind: 'profile', routeId }) : s.closeOverlay('profile')),
    }),
  },
  {
    id: 'section', group: 'section', icon: CrossSectionIcon, titleKey: 'platform_cross_section', place: 'top', Component: CrossSectionsPanel,
    overlay: 'crossSection',
    props: (s) => ({
      // Over the map or in its own window — a station picked goes to where it is shown.
      crossSectionAt: [s.overlay, s.detached].find(o => o?.kind === 'crossSection')?.at ?? null,
      onShowCrossSection: (at) => (at ? s.openOverlay({ kind: 'crossSection', at }) : s.closeOverlay('crossSection')),
    }),
  },
  {
    id: 'check', group: 'check', icon: CheckIcon, titleKey: 'check_title', place: 'top', Component: CheckPanel,
    overlay: 'bands',
    props: (s) => ({
      onShowPhysics: s.showPhysics, onShowRegelwerk: s.showRegelwerk,
      bandsTrackId: s.overlay?.kind === 'bands' ? s.overlay.trackId : null,
      onShowBands: (trackId) => (trackId ? s.openOverlay({ kind: 'bands', trackId }) : s.closeOverlay('bands')),
    }),
  },
  {
    id: 'data', group: 'exchange', icon: DataExchangeIcon, titleKey: 'data_exchange', place: 'top', Component: DataExchangePanel,
    props: (s) => ({ onShowCompare: s.setCompare }),
  },
  {
    id: 'plan', group: 'plan', icon: PlanExportIcon, titleKey: 'plan_title', place: 'top', Component: PlanExportPanel,
    overlay: 'planPreview',
    props: (s) => ({
      onShowPlanPreview: (preview) => (preview ? s.openOverlay({ kind: 'planPreview', ...preview }) : s.closeOverlay('planPreview')),
    }),
  },
  {
    id: 'info', group: 'app', icon: InfoIcon, titleKey: 'info', place: 'bottom', Component: InfoPanel,
    props: (s) => ({ onDraw: () => s.selectPanel('places'), onImport: () => s.selectPanel('data') }),
  },
  {
    id: 'settings', group: 'app', icon: SettingsIcon, titleKey: 'settings', place: 'bottom', Component: SettingsPanel,
    props: (s) => ({ color: s.color, onColorChange: s.setColor }),
  },
]

export const panelById = (id) => PANELS.find(p => p.id === id) ?? null
