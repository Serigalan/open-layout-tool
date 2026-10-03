import { recalcAbsLengths, rebuildCoords } from './trackModel'
import { truncateHeights } from './heightUtils'

// What the optimize dialog sends and keeps (R5.5): the request for a run, and
// the track a result makes — apart from the dialog that collects the settings.

/** The request for a run of the optimizer over `track`, or over its element `elementIdx`. */
export function optimizeRequest(track, { corridorCm, grenzwert, vMax, regelwerkId, elementIdx = null }) {
  return {
    track, corridorCm, grenzwert, uebergang: 'auto', maxiter: 100,
    ...(Number(vMax) > 0 ? { vMax: Number(vMax) } : {}),
    ...(regelwerkId ? { regelwerk: regelwerkId } : {}),
    ...(elementIdx != null ? { targetElementIdx: elementIdx } : {}),
  }
}

/**
 * The vertical alignment the optimized track keeps. It is stationed along the
 * track and independent of the elements, so re-shaping them changes nothing
 * for it as long as their lengths do — where the first length moves, the
 * stations behind it move with it, and the rest is left without a gradient
 * until it is read from the terrain on request (see elevationFill).
 */
export function reshapedHeights(track, elements) {
  const old = track.elements ?? []
  const i = elements.findIndex((el, k) => (el.length ?? 0) !== (old[k]?.length ?? 0))
  if (i === -1 && elements.length === old.length) return track.heights
  const cutAt = elements.slice(0, Math.max(0, i)).reduce((sum, el) => sum + (el.length ?? 0), 0)
  return truncateHeights(track.heights, cutAt)
}

/**
 * The track as the result has it: the optimized elements, the heights that
 * still hold, and the regelwerk it was drawn under and at which level —
 * without them a design a few years old is not reproducible.
 */
export function optimizedTrack(track, result) {
  const elements = recalcAbsLengths(result.elements)
  return {
    ...track, elements, coordinates: rebuildCoords(elements),
    heights: reshapedHeights(track, elements),
    regelwerk: result.regelwerk,
    regelwerkGrenzwert: result.grenzwert,
  }
}

/**
 * What a failed run says. A topology the optimizer will not take comes back
 * with its own sentence — that names the actual element sequence, which no
 * generic key can. Everything else is translated from its code.
 */
export function optimizeErrorText(t, code, detail) {
  if (detail) return detail
  const translated = t(`optimize_err_${code}`)
  return translated === `optimize_err_${code}` ? t('optimize_err_internal') : translated
}
