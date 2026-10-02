import { portsOf } from './switchModel'

/**
 * What a track end says about itself when nothing is connected to it: a
 * buffer stop stands there, or the drawing simply stops (a boundary of the
 * planning area — the line runs on, it is only not drawn).
 *
 * A mark is a record of its own, `project.endMarks`, naming its end the way a
 * switch port does: a track id plus BEGIN or END. That is deliberate. Tracks
 * are split, reversed and joined in a dozen places, and every one of them
 * already hands the switch ports a remap that says where each end went
 * (storage.remapSwitches). A mark rides the same remap and lands on the same
 * end; a field on the track would have to be carried by each of those places
 * by hand, and a split copying the track's fields to both halves would put one
 * buffer stop on both.
 *
 * An end carries at most one mark, and only while nothing is connected to it:
 * a switch port taking the end over, or its track going, takes the mark with
 * it (pruneEndMarks).
 */

export const BUFFER_STOP = 'buffer_stop'
export const BOUNDARY    = 'boundary'
const END_MARK_KINDS = [BUFFER_STOP, BOUNDARY]

/**
 * The buffer stop types. A placeholder for now (ROADMAP decision 76): the type
 * is stored and proposes the brake length, and does nothing else.
 */
export const BUFFER_STOP_TYPES = [4, 6, 8, 10]
export const DEFAULT_BUFFER_STOP_TYPE = BUFFER_STOP_TYPES[0]

/** Length of the buffer stop itself along the track [m] (decision 77). */
export const BUFFER_STOP_LENGTH = 2.2

/** The brake length a type proposes [m]: its own number. */
export const defaultBrakeLength = (type) => Number(type)

export const endKey = (trackId, endpoint) => `${trackId}|${endpoint}`

const flipEndpoint = (e) => (e === 'BEGIN' ? 'END' : e === 'END' ? 'BEGIN' : e)

export function newBufferStop(trackId, endpoint, type = DEFAULT_BUFFER_STOP_TYPE, brakeLength = defaultBrakeLength(type)) {
  return { id: crypto.randomUUID(), kind: BUFFER_STOP, trackId, endpoint, type, brakeLength }
}

export function newBoundary(trackId, endpoint) {
  return { id: crypto.randomUUID(), kind: BOUNDARY, trackId, endpoint }
}

/** Does a buffer stop with this brake length fit on a track this long? */
export const bufferStopFits = (trackLength, brakeLength) =>
  Number.isFinite(brakeLength) && brakeLength >= 0 && trackLength + 1e-9 >= brakeLength + BUFFER_STOP_LENGTH

/**
 * Where a buffer stop lies along its track [m from BEGIN]: the buffer face
 * (where a train meets it), the body behind the face, and the brake length
 * between the body and the track end.
 *
 *   ─────────────┬──────────┬──────────────┤ END
 *                │   body   │ brake length │
 *              face
 *
 * At BEGIN the same picture is mirrored. Stations are clamped to the track, so
 * a track shortened after the stop was placed draws what still fits.
 */
export function bufferStopStations(trackLength, mark) {
  const clamp = (s) => Math.min(trackLength, Math.max(0, s))
  const brake = Math.max(0, Number(mark.brakeLength) || 0)
  if (mark.endpoint === 'BEGIN') {
    return {
      face:  clamp(brake + BUFFER_STOP_LENGTH),
      body:  [clamp(brake), clamp(brake + BUFFER_STOP_LENGTH)],
      brake: [0, clamp(brake)],
    }
  }
  return {
    face:  clamp(trackLength - brake - BUFFER_STOP_LENGTH),
    body:  [clamp(trackLength - brake - BUFFER_STOP_LENGTH), clamp(trackLength - brake)],
    brake: [clamp(trackLength - brake), trackLength],
  }
}

/**
 * Carry the marks through a change of track ids — the same remap entries
 * remapSwitches takes: `newId` an array [first, second] for a split (BEGIN
 * stays on the first half, END goes with the second), a plain id for a rename
 * or a join, with `flip` when the track was folded in backwards.
 *
 * `consumed` lists ends that stop being ends in the same change — the two ends
 * a splice joins. Their marks go before the remap, which would otherwise move
 * them onto whatever end of the joined track the remap sends that track to.
 */
export function remapEndMarks(marks, remap, consumed = []) {
  if (!marks?.length) return marks
  const gone = new Set(consumed.map(e => endKey(e.trackId, e.endpoint)))
  return marks
    .filter(m => !gone.has(endKey(m.trackId, m.endpoint)))
    .map(m => {
      const entry = remap.find(r => r.oldId === m.trackId)
      if (!entry) return m
      if (Array.isArray(entry.newId)) {
        return { ...m, trackId: m.endpoint === 'BEGIN' ? entry.newId[0] : entry.newId[1] }
      }
      return { ...m, trackId: entry.newId, endpoint: entry.flip ? flipEndpoint(m.endpoint) : m.endpoint }
    })
}

/** Swap BEGIN and END of the marks on a track that was reversed. */
export function flipEndMarks(marks, trackId) {
  if (!marks?.length) return marks
  return marks.map(m => (m.trackId === trackId ? { ...m, endpoint: flipEndpoint(m.endpoint) } : m))
}

/** The `trackId|endpoint` keys a switch port holds. */
function portEnds(switches) {
  const held = new Set()
  for (const sw of switches ?? []) {
    for (const { trackKey, endKey: ek } of portsOf(sw)) {
      if (sw[trackKey] && sw[ek]) held.add(endKey(sw[trackKey], sw[ek]))
    }
  }
  return held
}

/**
 * The marks that still mean something: on a track that exists, at an end no
 * switch port has taken over, one per end (the first one kept). Returns the
 * same array when nothing had to go, so a caller can tell by identity.
 */
export function pruneEndMarks(marks, tracks, switches) {
  if (!marks?.length) return marks
  const ids  = new Set((tracks ?? []).map(t => t.id))
  const held = portEnds(switches)
  const seen = new Set()
  const kept = marks.filter(m => {
    const key = endKey(m.trackId, m.endpoint)
    if (!ids.has(m.trackId) || held.has(key) || seen.has(key)) return false
    if (!END_MARK_KINDS.includes(m.kind)) return false
    seen.add(key)
    return true
  })
  return kept.length === marks.length ? marks : kept
}
