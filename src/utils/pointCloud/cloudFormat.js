import { FILE_CRS_OPTIONS } from '../coordinateUtils'

// How the point cloud dialog states numbers, and which planes it offers.

/** Every plane a cloud may be stated in: any a file may be. */
export const CLOUD_CRS = FILE_CRS_OPTIONS.map(o => o.code)

const oneDecimal = { maximumFractionDigits: 1 }

/** Bytes in MB. */
export const mb = (bytes) => `${(bytes / 1e6).toLocaleString(undefined, oneDecimal)} MB`

/** Bytes in MB, or in GB from one GB on. */
export const sizeText = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toLocaleString(undefined, oneDecimal)} GB` : mb(bytes))

/** A grid step [m] in millimetres, „1 mm“ or „0,1 mm“. */
export const stepText = (m) => `${(m * 1000).toLocaleString(undefined, { maximumSignificantDigits: 3 })} mm`

/** A count with the thousands grouped. */
export const count = (n) => Number(n).toLocaleString()

/** Seconds as „3 min 05 s“ or „42 s“, „…“ while not known. */
export function duration(s) {
  if (s == null || !Number.isFinite(s)) return '…'
  const m = Math.floor(s / 60), sec = Math.round(s % 60)
  return m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`
}

/**
 * The coordinate system an E57 file states, short enough for the dialog: a
 * WKT's name with its EPSG code (the outermost one comes last in WKT 1 and 2),
 * anything else as written, cut.
 */
export function crsHint(text) {
  const name = text.match(/^\s*[A-Z_0-9]+\s*\[\s*"([^"]+)"/)?.[1]
  const code = [...text.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)].at(-1)?.[1]
  if (name) return code ? `${name} (EPSG:${code})` : name
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}
