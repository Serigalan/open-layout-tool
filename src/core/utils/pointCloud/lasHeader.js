/**
 * The header of a LAS or LAZ file (ASPRS LAS 1.0–1.4) and the LASzip record
 * that says how a LAZ file is compressed — everything the reader needs before
 * the first point, read from the first few kilobytes of the file.
 *
 * Only what the point cloud import uses is read: where the points start, how
 * many there are, how long one is and how its integers turn into metres, and
 * the box the file states for itself. Coordinate systems a header may name
 * (GeoKeys, WKT) are not read: the deliveries this is for name none, and the
 * import asks for both datums anyway (Entscheidung 118).
 */

/** How many bytes of the file are enough to read the header and its VLRs. */
export const HEADER_PROBE_BYTES = 64 * 1024

const LASZIP_USER_ID = 'laszip encoded'
const LASZIP_RECORD_ID = 22204
/** chunk_size of a LAZ file whose chunks differ in length — the table then states each. */
export const VARIABLE_CHUNK_SIZE = 0xFFFFFFFF

/**
 * Where a point record of each format holds its colour (three Uint16, red,
 * green, blue), by point format — formats without colour are not listed.
 */
const RGB_OFFSET = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }

const ascii = (bytes, from, length) => {
  let s = ''
  for (let i = from; i < from + length && bytes[i]; i++) s += String.fromCharCode(bytes[i])
  return s
}

/**
 * The header of a LAS/LAZ file from its first bytes (at least
 * HEADER_PROBE_BYTES, or the whole file if shorter). Throws on anything that
 * is not one.
 *
 * `compressed` says whether the point records are LAZ; `laszip` then holds
 * the compressor's record (chunk size) — a LAZ file without it cannot be read.
 */
export function parseLasHeader(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 227 || ascii(bytes, 0, 4) !== 'LASF') throw new Error('not a LAS file')
  const versionMajor = bytes[24], versionMinor = bytes[25]
  const headerSize = view.getUint16(94, true)
  const pointDataOffset = view.getUint32(96, true)
  const vlrCount = view.getUint32(100, true)
  const formatByte = bytes[104]
  // LAZ marks itself by setting bit 7 (or 6, in old writers) of the format.
  const compressed = (formatByte & 0xC0) !== 0
  const pointFormat = formatByte & 0x3F
  const pointLength = view.getUint16(105, true)
  let pointCount = view.getUint32(107, true)
  // LAS 1.4 keeps the legacy count at 0 when the 64-bit one is needed.
  if (versionMinor >= 4 && headerSize >= 375) {
    const big = Number(view.getBigUint64(247, true))
    if (big > 0) pointCount = big
  }
  const scale  = [view.getFloat64(131, true), view.getFloat64(139, true), view.getFloat64(147, true)]
  const offset = [view.getFloat64(155, true), view.getFloat64(163, true), view.getFloat64(171, true)]
  const max = [view.getFloat64(179, true), view.getFloat64(195, true), view.getFloat64(211, true)]
  const min = [view.getFloat64(187, true), view.getFloat64(203, true), view.getFloat64(219, true)]

  let laszip = null
  let at = headerSize
  for (let i = 0; i < vlrCount && at + 54 <= bytes.length; i++) {
    const userId = ascii(bytes, at + 2, 16)
    const recordId = view.getUint16(at + 18, true)
    const length = view.getUint16(at + 20, true)
    const body = at + 54
    if (userId === LASZIP_USER_ID && recordId === LASZIP_RECORD_ID && body + 34 <= bytes.length) {
      laszip = {
        compressor: view.getUint16(body, true),
        coder: view.getUint16(body + 2, true),
        version: `${bytes[body + 4]}.${bytes[body + 5]}r${view.getUint16(body + 6, true)}`,
        chunkSize: view.getUint32(body + 12, true),
      }
    }
    at = body + length
  }
  if (compressed && !laszip) throw new Error('LAZ file without a LASzip record')
  // 2 and 3 are the chunked compressors every LASzip since 2.0 writes; 1, the
  // unchunked one, keeps no chunk table to stream by.
  if (compressed && laszip.compressor !== 2 && laszip.compressor !== 3) {
    throw new Error(`LAZ compressor ${laszip.compressor} is not supported`)
  }

  const rgbOffset = RGB_OFFSET[pointFormat] ?? null
  return {
    version: `${versionMajor}.${versionMinor}`,
    compressed, pointFormat, pointLength, pointCount, pointDataOffset,
    scale, offset, min, max, laszip,
    rgb: rgbOffset != null && pointLength >= rgbOffset + 6,
    rgbOffset,
  }
}
