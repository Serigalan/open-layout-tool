// topology — the diagram of the topological connections: graph, lanes along
// the lines, label placement.
//
// This file is the module's public face: code outside src/core/utils/topology/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/topology.md.

export { labelBox, placeLabels } from './labelPlacement'
export { buildTopologyGraph, selectionHighlight, topologyClusters } from './topologyGraph'
export { layoutClusterLanes } from './topologyLanes'
