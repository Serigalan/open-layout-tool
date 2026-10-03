import { EPSG_OPTIONS } from '../coordinateUtils'

// How the point cloud dialog states numbers, and which planes it offers.

/**
 * Every plane a cloud may be stated in — all of them projStringFor knows, not
 * only the ones a new track is offered: a survey comes in whatever system the
 * surveyor used, DHDN Gauss-Krüger among them.
 */
export const CLOUD_CRS = [...new Set([
  ...EPSG_OPTIONS.map(o => o.code),
  5680, 5676, 5677, 5678, 5679,   // DHDN / GK 1–5
  3396, 3397, 3398, 3399,         // PD/83, RD/83
  2397, 2398, 2399, 3068,         // 42/83, Soldner Berlin
])]

const oneDecimal = { maximumFractionDigits: 1 }

/** Bytes in MB. */
export const mb = (bytes) => `${(bytes / 1e6).toLocaleString(undefined, oneDecimal)} MB`

/** Bytes in MB, or in GB from one GB on. */
export const sizeText = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString(undefined, oneDecimal)} GB` : mb(bytes))

/** A count with the thousands grouped. */
export const count = (n) => Number(n).toLocaleString()

/** Seconds as „3 min 05 s“ or „42 s“, „…“ while not known. */
export function duration(s) {
  if (s == null || !Number.isFinite(s)) return '…'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`
}
