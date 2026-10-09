import { extend, provide } from '../core/extensions'
import {
  SpliceJoinIcon, ReconnectIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon, AxisFitModeIcon,
} from '../core/components/icons'
import { fetchRegelwerk, fetchRegelwerke } from './optimizerService'
import ServiceStatus from './ServiceStatus'
import { dgm1Source } from './terrainDgm1'
import { serverClouds } from './cloudsOnServer'
import useCloudServer from './useCloudServer'
import useServerRun from './useServerRun'
import useCloudRegistration from './cloud3d/useCloudRegistration'
import CrossSectionCloudTools from './cloud3d/CrossSectionCloudTools'
import Cloud3dLink from './cloud3d/Cloud3dLink'
import { legacySection, workingCopiesSection } from './localStoreSections'
import {
  AxisFitTool, MdbDbrefImport, MdbImport, OptimizeElementTool, OptimizeTrackTool, ReconnectTool, SpliceTool,
} from './panels/tools'

/**
 * The server components dock onto core (Paket L, decision 277): everything
 * core offers an extension point for (core/extensions.js) is filled here,
 * once, when the main build starts — before the first render. The local
 * build never imports this file.
 */

// Splicing and reconnecting (the optimizer service) in the panel that connects elements.
extend('panelTools', { panel: 'splice', id: 'splice', icon: SpliceJoinIcon, titleKey: 'splice_start', Component: SpliceTool })
extend('panelTools', { panel: 'splice', id: 'reconnect', icon: ReconnectIcon, titleKey: 'reconnect_title', Component: ReconnectTool })

// The optimizer and the alignment fit in the check panel.
extend('panelTools', { panel: 'check', id: 'track', section: 'check_optimize', icon: OptimizeTrackModeIcon, titleKey: 'optimize_mode_track', Component: OptimizeTrackTool })
extend('panelTools', { panel: 'check', id: 'element', section: 'check_optimize', icon: OptimizeElementModeIcon, titleKey: 'optimize_mode_element', Component: OptimizeElementTool })
extend('panelTools', { panel: 'check', id: 'axis', section: 'check_optimize', icon: AxisFitModeIcon, titleKey: 'optimize_mode_axis', Component: AxisFitTool })

// The two MDB importers (the service converts the database).
extend('importSections', { id: 'mdb', Component: MdbImport })
extend('importSections', { id: 'mdb-dbref', Component: MdbDbrefImport })

// Whether the services are there, at the sidebar's foot (R10.12).
extend('sidebarFoot', ServiceStatus)

// The Länder's DGM1, read by the service.
extend('terrainSources', dgm1Source)

// The rule catalogues as the service has them (the regelwerk popup).
provide('regelwerkService', { list: fetchRegelwerke, get: fetchRegelwerk })

// Point clouds on the server: read, listed and uploaded in the panel, long
// runs there, and the 3D window — its link from the map view, its button
// beside the cross section, its re-referencing seen in the section.
extend('cloudProviders', serverClouds)
provide('useCloudServer', useCloudServer)
provide('useServerRun', useServerRun)
provide('useCloudRegistration', useCloudRegistration)
extend('crossSectionTools', CrossSectionCloudTools)
extend('workspaceAddons', Cloud3dLink)

// What the working copies and the stores of version 1 take in this browser.
extend('localStoreSections', workingCopiesSection)
extend('localStoreSections', legacySection)
