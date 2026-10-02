import { generateId } from '../identifierUtils'
import { nextTrackName, rebuildCoords, recalcAbsLengths } from '../trackModel'
import { crsDatum, crsLabel } from '../coordinateUtils'
import {
  buildAllTracksFromMdb, buildTracksFromMdb, mdbSwitchInventory, mdbBufferStops, matchMdbBufferStops,
} from '../mdbImport'
import { placeMdbSwitches } from '../mdbSwitchPlacement'
import { linkAllJoints } from '../trackLinkUtils'
import { transformTrackToPlane } from '../planeTransform'
import { loadGridsFor } from '../ntv2Grid'

/** The line-number picker's entry for „every line in the file“. */
export const ALL_STRECKEN = '*'

/**
 * Every track into one plane, with the regional grids that cover them loaded
 * first. Each element is refitted to its own two transformed nodes, so the
 * nodes stay exactly where the transformation puts them and the lengths and
 * radii follow (planeTransform). What that cost is pushed onto `notes`: how
 * far the plane stretched, and how far a joint's tangent opened beyond what it
 * already was.
 */
export async function toPlane(tracks, target, notes, fill, { loadGrids = loadGridsFor } = {}) {
  const box = tracks.reduce((b, tr) => {
    const cs = tr.coordinates ?? []
    for (const c of [cs[0], cs[cs.length - 1]]) {
      if (!c) continue
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1])
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
    }
    return b
  }, [180, 90, -180, -90])

  // The area alone does not say which grid is worth loading: Hesse's is a
  // DHDN refinement and does a PD/83 chain in the same rectangle no good.
  const datums = [...new Set(tracks.map(tr => crsDatum(tr.epsg)).filter(Boolean))]
  const grids = await loadGrids(box, datums)
  notes.push(fill(grids.length ? 'data_exchange_mdb_grids' : 'data_exchange_mdb_grid_none', { names: grids.map(g => g.name).join(', ') }))

  let moved = 0, gap = 0, lo = Infinity, hi = -Infinity
  const out = tracks.map(tr => {
    if (Number(tr.epsg) === target) return tr
    const res = transformTrackToPlane(tr, target)
    if (!res) return tr
    moved += 1
    gap = Math.max(gap, res.tangentGap)
    lo = Math.min(lo, res.scale.min); hi = Math.max(hi, res.scale.max)
    return res.track
  })
  if (moved) {
    notes.push(fill('data_exchange_mdb_moved', { n: moved, crs: crsLabel(target), mm: (Math.max(Math.abs(lo - 1), Math.abs(hi - 1)) * 1000).toFixed(2), deg: gap.toExponential(1) }))
  }
  return out
}

/**
 * What importing `strecke` of an MDB payload (or ALL_STRECKEN) adds to a
 * project holding `existing` ({ tracks, switches }): the tracks, the switches
 * placed on them and the links at their joints, the buffer stops — as one
 * commit — and the notes for the import report.
 *
 * `target` puts every track into that plane (the DB_REF import) instead of
 * leaving each chain in the one it was surveyed in.
 *
 * Returns { notes, counts: { tracks, switches }, commit } — `commit` null when
 * nothing could be built.
 */
export async function runMdbImport({
  payload, strecke, withSwitches = true, target = null, existing = {}, fill,
  newId = generateId, loadGrids,
}) {
  const existingTracks = existing.tracks ?? []
  const existingSwitches = existing.switches ?? []
  // The whole file at once is the common case — a Betriebsstelle's switches
  // rarely sit on one line number, so picking a single one splits them up.
  const built = strecke === ALL_STRECKEN
    ? buildAllTracksFromMdb(payload)
    : buildTracksFromMdb(payload, strecke)
  const inventory = mdbSwitchInventory(payload)

  // Switches part the tracks they sit on, so this has to happen before
  // anything is saved: what comes back are the tracks as they are afterwards,
  // and records carrying their symbol — the same shape a switch dialog
  // commits, so an imported switch is stored and drawn like a built one.
  // `derive` is part of placing switches, not a choice of its own: a track
  // that ends on another one is a turnout whether or not Satzart 31 says so
  // (mdbSwitchDerive), and an import that drew the one and left out the other
  // would hand over a network that is wrong where it is quietest.
  const placed = withSwitches
    ? placeMdbSwitches(payload, built.tracks, inventory.units, {
      newId, existingSwitches, derive: true,
    })
    : { tracks: built.tracks, switches: [], errors: [] }

  const notes = [...built.errors, ...inventory.errors, ...placed.errors]
  if (!placed.tracks.length) return { notes, counts: { tracks: 0, switches: 0 }, commit: null }

  const names = new Set(existingTracks.map(tr => tr.name).filter(Boolean))
  let addTracks = placed.tracks.map(tr => {
    const elements = recalcAbsLengths(tr.elements)
    const name = !tr.name || names.has(tr.name)
      ? nextTrackName((tr.name ?? 'mdb').split('.')[0], names)
      : tr.name
    names.add(name)
    return { ...tr, id: tr.id ?? newId(), name, elements, coordinates: rebuildCoords(elements) }
  })

  // Into one plane, for the importer that was asked for that. The survey
  // states its alignment in the Landessystem and the railway works in
  // DB_REF, and a track carries one plane — so the chains come in as many
  // planes as the file uses and stay cut at every boundary between them.
  // Carried over, they are one network in one plane, and what is written is
  // DB_REF coordinates: the Landessystem is gone from the project, not
  // converted again for every draw.
  //
  // The grids come first and only then: a finer regional grid is worth its
  // 80 MB for the one conversion an import is, and which one is worth
  // loading cannot be known before the data says where it lies.
  if (target) addTracks = await toPlane(addTracks, target, notes, fill, { loadGrids })

  // The chains the import builds are cut wherever the Lagesystem changes, and
  // those cuts are joints, not ends — so they are linked here rather than
  // left for someone to find. It runs over the project as it will be, tracks
  // and switches together: a switch port claims an end, and what a turnout
  // already holds is not an open joint. Last, because the ids are handed out
  // above and a port names a track by its id.
  const afterTracks   = [...existingTracks, ...addTracks]
  const afterSwitches = [...existingSwitches, ...placed.switches]
  const { links, joints, fanned } = linkAllJoints(afterTracks, afterSwitches,
    afterSwitches.map(sw => sw.name).filter(Boolean))
  if (links.length) {
    notes.push(fill('data_exchange_mdb_links', { n: links.length, crs: joints.filter(j => j.crsChange).length }))
  }
  if (fanned) notes.push(fill('data_exchange_mdb_fanned', { n: fanned }))

  // Buffer stops (Satzart 31, form „Prellbock") go on the free track end
  // they stand at. The file names no type and no brake length, so each
  // stands right at its end until someone sets it (ROADMAP decision 79).
  const stops = mdbBufferStops(payload)
  const buffered = matchMdbBufferStops(stops, afterTracks, [...afterSwitches, ...links])
  if (stops.length) {
    notes.push(fill('data_exchange_mdb_buffer_stops', { n: buffered.marks.length, missed: buffered.missed }))
  }

  return {
    notes,
    counts: { tracks: addTracks.length, switches: placed.switches.length },
    commit: { addTracks, addSwitches: [...placed.switches, ...links], addEndMarks: buffered.marks },
  }
}
