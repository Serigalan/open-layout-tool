import { elementStations, portEnd, portTrack, remapSwitches, stationOnTrack } from '../track'
import { DEFAULT_MIDS, planSwitchDeletion, switchParts, SWITCH_TYPES } from '../switch'
import { adoptCrossover } from './crossover'
import { connectionPick, settleConnection } from './sCurve'

// Editing a switch connection (Entscheidung 364): a track that begins and
// ends at a turnout's route, with no more than three elements of its own
// between the two turnouts' routes, is laid again by the switch connection's
// own construction — the turnouts may move along their tracks, their form and
// the speed stay. To do that, the connection is taken apart in memory: the
// connecting track goes, each turnout is deleted as the delete dialog deletes
// one — its line joined back into the track it was laid into —, and the
// dialog then works on what is left as if the two tracks had been picked
// where the toes stood. Committed, the same steps run on the project and the
// new connection takes the old one's switch ids, names and track.

/** The most elements a switch connection has between the turnouts' routes (the dialog's maximum). */
const EDIT_MAX_MIDS = 3

const nodeUtmOf = (node, epsg) => ({ easting: node[0], northing: node[1], zone: epsg })

const isTurnout = (sw) => !sw?.kind || sw.kind === 'turnout'
const ROUTE_PORTS = ['B1', 'B2']

/** The port of `sw` that names `trackId` at `endpoint`, or null. */
const portAt = (sw, trackId, endpoint) => ['A', ...ROUTE_PORTS]
  .find(port => portTrack(sw, port) === trackId && portEnd(sw, port) === endpoint) ?? null

/**
 * The switch connection track `trackId` is — or why it is none: { error } with
 * a locale key. It begins at a route of one turnout and ends at a route of
 * another, of one form the connection dialog knows, and between the two
 * turnouts' own elements lie one to EDIT_MAX_MIDS elements of its own.
 *
 * Returns { conn, turnouts: [first, second] — each { sw, port, linePort,
 * own } (`own` its elements on the connection) —, mids, form, speed }.
 */
export function switchConnectionOf({ trackId, tracks, switches }) {
  const conn = tracks.find(tr => tr.id === trackId)
  if (!conn?.elements?.length) return { error: 'crossover_edit_error_none' }
  const at = (endpoint) => {
    for (const sw of switches) {
      const port = portAt(sw, conn.id, endpoint)
      if (port) return { sw, port }
    }
    return null
  }
  const ends = [at('BEGIN'), at('END')]
  if (ends.some(e => !e || !ROUTE_PORTS.includes(e.port) || !isTurnout(e.sw))) return { error: 'crossover_edit_error_none' }
  if (ends[0].sw.switchId === ends[1].sw.switchId) return { error: 'crossover_edit_error_none' }
  const turnouts = ends.map(({ sw, port }) => ({
    sw, port,
    linePort: ROUTE_PORTS.find(p => p !== port),
    own: switchParts(sw, tracks).byPort[port]?.mine ?? [],
  }))
  const [first, second] = turnouts
  const mids = conn.elements.slice(first.own.length, conn.elements.length - second.own.length)
  if (!first.own.length || !second.own.length || mids.some(el => el.switchId)) return { error: 'crossover_edit_error_none' }
  if (mids.length < 1 || mids.length > EDIT_MAX_MIDS) return { error: 'crossover_edit_error_mids' }
  const form = SWITCH_TYPES.find(f => f.label === first.sw.label)
  if (!form || second.sw.label !== first.sw.label) return { error: 'crossover_edit_error_form' }
  return { conn, turnouts, mids, form, speed: form.speed }
}

/**
 * A deletion plan (planSwitchDeletion) carried out on `tracks` and
 * `switches` the way storage.commitSwitchDeletion carries it out.
 */
function applyDeletion({ tracks, switches }, plan) {
  const removed = new Set(plan.removeTrackIds)
  const updated = new Map(plan.updateTracks.map(t => [t.id, t]))
  const rest = switches.filter(sw => sw.switchId !== plan.switchId)
  return {
    tracks: tracks.filter(t => !removed.has(t.id)).map(t => updated.get(t.id) ?? t),
    switches: plan.remap?.length ? remapSwitches(rest, plan.remap) : rest,
  }
}

/** The far end of a turnout's line route from its toe: its switch end (WE), as a plane point. */
function lineEnd(sw, linePort, tracks) {
  const part = switchParts(sw, tracks).byPort[linePort]
  const own = part?.mine ?? []
  if (!own.length || !part.track) return null
  const el = part.endpoint === 'END' ? own[0] : own[own.length - 1]
  return nodeUtmOf(part.endpoint === 'END' ? el.startNode : el.endNode, part.track.epsg)
}

/**
 * Where a turnout stood, on the track its deletion left: the element its
 * through route lay on and the toe's distance along it — the pick the dialog
 * would have made there. Read from the toe and the switch end projected onto
 * the tracks the deletion rewrote.
 */
function pickWhereItStood(toe, end, candidates) {
  let best = null
  for (const track of candidates) {
    const a = stationOnTrack(track, toe)
    const b = end && stationOnTrack(track, end)
    if (!a || !b || a.dist > 1e-3 || b.dist > 1e-2) continue
    if (!best || a.dist + b.dist < best.dist) best = { track, toe: a.station, end: b.station, dist: a.dist + b.dist }
  }
  if (!best) return null
  // The element under the middle of the through route: a toe on a node lies
  // on the element its turnout opens into.
  const mid = (best.toe + best.end) / 2
  const row = elementStations(best.track).find(r => mid >= r.start - 1e-9 && mid <= r.end + 1e-9)
  if (!row) return null
  return connectionPick(best.track, row.index, Math.min(row.el.length, Math.max(0, best.toe - row.start)))
}

/**
 * The connection `found` (switchConnectionOf) taken apart in memory: the
 * project's `tracks` and `switches` without the connecting track and both
 * turnouts, each turnout's line joined back into its track — and the two
 * picks where the toes stood, on those tracks. { error } where a turnout's
 * line does not run on through it or the two toes end up on one track.
 *
 * Returns { tracks, switches, plans: [first, second], picks }.
 */
export function takeApart(found, { tracks, switches }) {
  const { conn, turnouts } = found
  const ends = turnouts.map(({ sw, linePort }) => lineEnd(sw, linePort, tracks))
  const toes = [conn.elements[0].startNode, conn.elements[conn.elements.length - 1].endNode]
    .map(node => nodeUtmOf(node, conn.epsg))
  let state = { tracks: tracks.filter(t => t.id !== conn.id), switches }
  const plans = []
  const touched = new Set()
  for (const { sw } of turnouts) {
    // The second turnout as the first one's deletion left it: its ports may
    // name the track that deletion joined.
    const now = state.switches.find(s => s.switchId === sw.switchId)
    const plan = planSwitchDeletion(now, state.tracks)
    if (!plan?.joined) return { error: 'crossover_edit_error_line' }
    plans.push(plan)
    plan.updateTracks.forEach(t => touched.add(t.id))
    state = applyDeletion(state, plan)
  }
  const candidates = state.tracks.filter(t => touched.has(t.id))
  const picks = toes.map((toe, k) => pickWhereItStood(toe, ends[k], candidates))
  if (picks.some(p => !p) || picks[0].trackId === picks[1].trackId) return { error: 'crossover_edit_error_line' }
  return { ...state, plans, picks }
}

/**
 * Where the dialog starts on a connection taken apart: the turnouts where they
 * stood (shift 0), the middle elements as they are, two of their values left
 * open so that they close again there — the connection as it is, whether the
 * rulebook accepts it or not. One element alone is the dialog's own arc,
 * length and radius open, which closes on a straight as well. Null where
 * they do not close there.
 *
 * Returns { shift, mids, seed }.
 */
export function editStart(found, apart) {
  if (found.mids.length === 1) {
    const { result, shift } = settleConnection({ picks: apart.picks, speed: found.speed, shift: 0, form: found.form })
    return result?.valid || result?.overridable ? { shift, mids: DEFAULT_MIDS, seed: null } : null
  }
  // The middle elements as an answer of the Python solver states them; the
  // toes stand where the picks are.
  const pieces = found.mids.map(el => (el.elementType === 2
    ? { type: 'transition', length: el.length }
    : el.radius == null
      ? { type: 'straight', length: el.length, kappa: 0 }
      : { type: 'arc', length: el.length, kappa: -1 / el.radius }))
  return adoptCrossover({
    picks: apart.picks, speed: found.speed, form: found.form, lenient: true,
    solution: { s1: 0, s2: 0, pieces },
  })
}

/**
 * The record a turnout of the edited connection is written as: the new one's
 * geometry and ports, everything else the old one carried — its id, name,
 * number, status, details.
 */
function keptRecord(old, laid) {
  const out = { ...laid }
  for (const [key, value] of Object.entries(old)) {
    if (!(key in out) && key !== 'swapped' && key !== 'mainRadius') out[key] = value
  }
  return { ...out, switchId: old.switchId, name: old.name, number: old.number }
}

/**
 * The commit of an edited connection, for storage.commitSwitchConnectionEdit:
 * the two deletions in order, then the connection `commit` (buildSCurve on
 * the tracks taken apart, with the old turnouts' identities) with the old
 * connecting track taken away too.
 */
export function editCommit(found, apart, commit) {
  if (!commit || commit.carveError) return commit
  const [first, second] = found.turnouts.map(t => t.sw)
  const bySwitch = new Map([[first.switchId, first], [second.switchId, second]])
  return {
    deletions: apart.plans,
    connection: {
      ...commit,
      removeTrackIds: [...commit.removeTrackIds, found.conn.id],
      addSwitches: commit.addSwitches.map(sw => (bySwitch.has(sw.switchId) ? keptRecord(bySwitch.get(sw.switchId), sw) : sw)),
    },
  }
}
