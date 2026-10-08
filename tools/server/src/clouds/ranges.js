import { openSync, closeSync, readSync, statSync } from 'node:fs'
import { ApiError } from '../errors.js'

/** Ranges one collective request may ask for (AP 13.5) … */
const MAX_RANGES = 64
/** … and bytes it may return at most. */
const MAX_RANGES_BYTES = 64 * 1024 * 1024

/**
 * Up to MAX_RANGES `[offset, length]` of a tile file, back to back in the
 * order asked — what a member's and a share link's ranges request answer.
 */
export function readRanges(path, ranges) {
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > MAX_RANGES) throw new ApiError(422, 'ranges_invalid')
  let total = 0
  for (const r of ranges) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || r[0] < 0 || r[1] <= 0) {
      throw new ApiError(422, 'ranges_invalid')
    }
    total += r[1]
  }
  if (total > MAX_RANGES_BYTES) throw new ApiError(413, 'too_large')
  const size = statSync(path).size
  const out = Buffer.allocUnsafe(total)
  const fd = openSync(path, 'r')
  try {
    let at = 0
    for (const [offset, length] of ranges) {
      if (offset + length > size) throw new ApiError(416, 'range_past_end')
      readSync(fd, out, at, length, offset)
      at += length
    }
  } finally {
    closeSync(fd)
  }
  return out
}
