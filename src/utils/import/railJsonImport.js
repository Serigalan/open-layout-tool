import { generateId } from '../identifierUtils'
import { nextTrackName, rebuildCoords, recalcAbsLengths } from '../trackModel'

/**
 * What a parsed RailJSON or alignment exchange file (osrdImport) adds to a
 * project: its tracks — under a fresh id where the project already has one,
 * renamed where the name is taken — the switches and buffer stops on them,
 * repointed to those ids, and the passthrough of everything the app does not
 * model (`osrd`), so an export hands it back.
 *
 * Returns { addTracks, addSwitches, addEndMarks, osrd }.
 */
export function planRailJsonImport({ tracks, switches = [], endMarks = [], infra = {} }, {
  existingTracks = [], existingMarks = [], newId = generateId,
} = {}) {
  const existingIds = new Set(existingTracks.map(tr => tr.id))
  const names = new Set(existingTracks.map(tr => tr.name).filter(Boolean))
  const idMap = {}
  const addTracks = tracks.map(tr => {
    const elements = recalcAbsLengths(tr.elements)
    const name = tr.name && !names.has(tr.name)
      ? tr.name
      : nextTrackName(tr.name?.split('.')[0] || 'track', names)
    names.add(name)
    const id = existingIds.has(tr.id) ? newId() : (tr.id ?? newId())
    if (tr.id && id !== tr.id) idMap[tr.id] = id
    return { ...tr, id, name, elements, coordinates: rebuildCoords(elements) }
  })
  const remapId = (id) => idMap[id] ?? id

  // Switches the import could rebuild into the app's own model — they are
  // drawn as switch bodies and regenerated on the next export, which is why
  // the passthrough copy is dropped there by id.
  const addSwitches = switches.map(sw => ({
    ...sw,
    portA_trackId:  sw.portA_trackId  ? remapId(sw.portA_trackId)  : sw.portA_trackId,
    portB1_trackId: sw.portB1_trackId ? remapId(sw.portB1_trackId) : sw.portB1_trackId,
    portB2_trackId: sw.portB2_trackId ? remapId(sw.portB2_trackId) : sw.portB2_trackId,
  }))

  // Buffer stops stand on the imported track ends; one whose id the project
  // already uses (the same file imported twice) gets a new one, or it would
  // take the place of the first.
  const markIds = new Set(existingMarks.map(m => m.id))
  const addEndMarks = endMarks.map(mark => ({
    ...mark, id: markIds.has(mark.id) ? newId() : mark.id, trackId: remapId(mark.trackId),
  }))

  // Ports of carried-over switches follow tracks that had to be re-id'd.
  const remapPorts = (sw) => ({
    ...sw,
    ports: Object.fromEntries(Object.entries(sw.ports ?? {}).map(([k, p]) =>
      [k, idMap[p?.track] ? { ...p, track: idMap[p.track] } : p])),
  })
  const osrd = { ...infra, ...(infra.switches ? { switches: infra.switches.map(remapPorts) } : {}) }

  return { addTracks, addSwitches, addEndMarks, osrd }
}
