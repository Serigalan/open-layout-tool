import useCloud3dChannel from './useCloud3dChannel'

/**
 * The map view's side of the 3D window (AP 13.10), as an add-on of the map
 * view (`workspaceAddons`, Paket L): the 3D window follows the cross section
 * shown, and a double click there shows the cross section here.
 */
export default function Cloud3dLink({ project, crossSectionAt, onShowCrossSection }) {
  useCloud3dChannel({ project, at: crossSectionAt, onShowCrossSection })
  return null
}
