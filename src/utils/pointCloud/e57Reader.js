import { parseXml, child } from './e57Xml'

/**
 * Reading the points of an E57 file (ASTM E2807) in pieces, the way lasReader
 * reads LAS/LAZ: through a `source` — `{ size, read(offset, length) }` — and
 * never the whole file at once, so a terrestrial survey of many gigabytes goes
 * through in a bounded heap.
 *
 * The file is a run of pages (1024 bytes, the last four of each a checksum,
 * passed over here), an XML section describing it, and binary sections. Each
 * scan (`data3D` child) has a pose — a rotation and a translation into the
 * file's frame — and its points as a CompressedVector: data packets, each
 * holding a piece of every field's bytestream. A field is a float (4 or 8
 * bytes) or an integer packed into as few bits as its range needs, scaled for
 * a ScaledInteger. Only the fields the import needs are decoded: the
 * coordinates (Cartesian, or spherical turned Cartesian), the invalid state,
 * the intensity and the colour (AP 13.4); the rest is passed over.
 *
 * What comes out are the same batches as from readLasPoints: x, y, z in the
 * file's frame (the pose applied), the intensity on 0…65535 between its
 * limits and, where every scan has colour, red, green and blue the same way. Points marked invalid are left out, so a batch may hold fewer
 * points than records were read.
 */

const SIGNATURE = 'ASTM-E57'
const HEADER_BYTES = 48
const CHECKSUM_BYTES = 4
/** Logical bytes of a CompressedVector read in one go. */
const WINDOW_BYTES = 4 * 1024 * 1024
/** The start of a scan read for its extent, when its stated bounds need a check. */
const SAMPLE_BYTES = 256 * 1024
/** A packet is at most this long (its length is stored as uint16, minus one). */
const MAX_PACKET = 65536
/** How far the sampled points may lie outside a stated box and it still holds [m]. */
const BOX_SLACK = 1

const INT64_MIN = -(2n ** 63n), INT64_MAX = 2n ** 63n - 1n

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/** Whether `bytes` (the start of a file) are an E57 file's. */
export const isE57 = (bytes) => bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === SIGNATURE

const u64 = (view, at) => Number(view.getBigUint64(at, true))

/** The file's logical bytes — its content without the page checksums. */
function pagedReader(source, pageSize) {
  const data = pageSize - CHECKSUM_BYTES
  return {
    logical: (physical) => Math.floor(physical / pageSize) * data + (physical % pageSize),
    async read(at, length) {
      if (length <= 0) return new Uint8Array(0)
      const first = Math.floor(at / data), last = Math.floor((at + length - 1) / data)
      const start = first * pageSize + (at % data)
      const end = last * pageSize + ((at + length - 1) % data) + 1
      if (end > source.size) throw new Error('E57 file is incomplete')
      const raw = await source.read(start, end - start)
      if (first === last) return raw
      const out = new Uint8Array(length)
      let from = 0, to = 0
      for (let page = first; page <= last; page++) {
        const take = Math.min(page === first ? data - (at % data) : data, length - to)
        out.set(raw.subarray(from, from + take), to)
        to += take
        from += take + CHECKSUM_BYTES
      }
      return out
    },
  }
}

// ── the XML: scans, their poses and fields ──────────────────────────────────

/** A Float or Integer element's value; an empty one is zero, a missing one `fallback`. */
const value = (node, fallback = 0) => {
  if (!node) return fallback
  const s = node.text.trim()
  return s === '' ? 0 : Number(s)
}

const bigAttr = (s, fallback) => {
  if (s == null || s === '') return fallback
  try { return BigInt(s) } catch { return BigInt(Math.round(Number(s))) }
}

/** How a prototype field is coded in its bytestream. */
function fieldCodec(node) {
  const { type, precision, minimum, maximum } = node.attrs
  if (type === 'Float') {
    return {
      kind: 'float', bytes: precision === 'single' ? 4 : 8,
      min: minimum != null ? Number(minimum) : null, max: maximum != null ? Number(maximum) : null,
    }
  }
  if (type === 'Integer' || type === 'ScaledInteger') {
    const lo = bigAttr(minimum, INT64_MIN), hi = bigAttr(maximum, INT64_MAX)
    const range = hi - lo
    const scale = type === 'ScaledInteger' && node.attrs.scale != null ? Number(node.attrs.scale) : 1
    const offset = type === 'ScaledInteger' && node.attrs.offset != null ? Number(node.attrs.offset) : 0
    return {
      kind: 'int', bits: range > 0n ? range.toString(2).length : 0,
      min: Number(lo), scale, offset,
      low: Number(lo) * scale + offset, high: Number(hi) * scale + offset,
    }
  }
  return { kind: type === 'String' ? 'string' : 'other' }
}

/** The prototype's terminal fields in bytestream order (depth first). */
function terminals(node, path, out) {
  for (const c of node.children) {
    if (c.attrs.type === 'Structure') terminals(c, `${path}${c.name}/`, out)
    else out.push({ name: path + c.name, ...fieldCodec(c) })
  }
  return out
}

/** The rotation matrix of a quaternion, row by row (normalised first). */
function quaternionMatrix(w, x, y, z) {
  const n = Math.hypot(w, x, y, z) || 1
  w /= n; x /= n; y /= n; z /= n
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ]
}

function parsePose(scan) {
  const pose = child(scan, 'pose')
  const r = child(pose, 'rotation'), t = child(pose, 'translation')
  return {
    rotation: r ? quaternionMatrix(value(child(r, 'w'), 1), value(child(r, 'x')), value(child(r, 'y')), value(child(r, 'z')))
      : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    translation: t ? ['x', 'y', 'z'].map(k => value(child(t, k))) : [0, 0, 0],
  }
}

/** The range the intensity spans: the scan's stated limits, else the field's own, else 0…1. */
function intensityRange(scan, field) {
  const limits = child(scan, 'intensityLimits')
  if (limits) {
    const lo = value(child(limits, 'intensityMinimum'), NaN), hi = value(child(limits, 'intensityMaximum'), NaN)
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi]
  }
  if (field.kind === 'int' && field.high > field.low) return [field.low, field.high]
  if (field.kind === 'float' && Number.isFinite(field.min) && Number.isFinite(field.max)
    && field.max > field.min && field.max - field.min < 1e30) return [field.min, field.max]
  return [0, 1]
}

/** The range a colour channel spans: the scan's colorLimits, else the field's own, else 0…255. */
function colorRange(scan, field, channel) {
  const limits = child(scan, 'colorLimits')
  if (limits) {
    const lo = value(child(limits, `color${channel}Minimum`), NaN), hi = value(child(limits, `color${channel}Maximum`), NaN)
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi]
  }
  if (field.kind === 'int' && field.high > field.low) return [field.low, field.high]
  return [0, 255]
}

const COLORS = ['Red', 'Green', 'Blue']

const CARTESIAN = ['cartesianX', 'cartesianY', 'cartesianZ']
const SPHERICAL = ['sphericalRange', 'sphericalAzimuth', 'sphericalElevation']

function parseScan(node, i) {
  const points = child(node, 'points')
  const name = child(node, 'name')?.text.trim() || `scan ${i + 1}`
  if (!points || points.attrs.type !== 'CompressedVector') throw new Error(`E57 scan "${name}" has no points`)
  const proto = child(points, 'prototype')
  if (!proto) throw new Error(`E57 scan "${name}" has no prototype`)
  if (child(points, 'codecs')?.children.length) throw new Error('E57 codecs other than bit packing are not supported')
  const fields = terminals(proto, '', [])
  const at = (n) => fields.findIndex(f => f.name === n)
  const cart = CARTESIAN.map(at), sph = SPHERICAL.map(at)
  const coords = cart.every(k => k >= 0) ? 'cartesian' : sph.every(k => k >= 0) ? 'spherical' : null
  const recordCount = Number(points.attrs.recordCount ?? 0)
  if (!coords && recordCount > 0) throw new Error(`E57 scan "${name}" has no coordinates`)
  const xyz = coords === 'spherical' ? sph : cart
  if (xyz.some(k => k >= 0 && fields[k].kind !== 'float' && fields[k].kind !== 'int')) {
    throw new Error(`E57 scan "${name}": coordinates of an unsupported type`)
  }
  const state = at(coords === 'spherical' ? 'sphericalInvalidState' : 'cartesianInvalidState')
  let intensity = at('intensity')
  if (intensity >= 0 && fields[intensity].kind !== 'float' && fields[intensity].kind !== 'int') intensity = -1
  const color = COLORS.map(c => at(`color${c}`))
  const hasColor = color.every(k => k >= 0 && (fields[k].kind === 'float' || fields[k].kind === 'int'))

  const cb = child(node, 'cartesianBounds')
  const bounds = cb
    ? ['xMinimum', 'yMinimum', 'zMinimum', 'xMaximum', 'yMaximum', 'zMaximum'].map(k => value(child(cb, k), NaN))
    : null
  const range = value(child(child(node, 'sphericalBounds'), 'rangeMaximum'), NaN)
  return {
    name, recordCount, fileOffset: Number(points.attrs.fileOffset ?? 0),
    fields, coords, xyz, state: state >= 0 ? state : null,
    intensity: intensity >= 0 ? intensity : null,
    intensityRange: intensity >= 0 ? intensityRange(node, fields[intensity]) : null,
    color: hasColor ? color : null,
    colorRange: hasColor ? color.map((k, c) => colorRange(node, fields[k], COLORS[c])) : null,
    ...parsePose(node),
    bounds: bounds?.every(Number.isFinite) ? bounds : null,
    rangeMaximum: Number.isFinite(range) && range > 0 ? range : null,
  }
}

// ── the bytestreams ──────────────────────────────────────────────────────────

const concat = (a, b) => {
  if (!a.length) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

/** Decoded values of one field, waiting until every needed field has its share. */
class Queue {
  constructor() { this.data = new Float64Array(4096); this.length = 0 }
  reserve(n) {
    if (this.length + n > this.data.length) {
      const grown = new Float64Array(Math.max(this.length + n, this.data.length * 2))
      grown.set(this.data.subarray(0, this.length))
      this.data = grown
    }
    const at = this.length
    this.length += n
    return at
  }
  drop(n) {
    this.data.copyWithin(0, n, this.length)
    this.length -= n
  }
}

/** A float field: little-endian IEEE values back to back. */
class FloatStream {
  constructor(bytes) { this.bytes = bytes; this.rest = new Uint8Array(0); this.queue = new Queue() }
  push(chunk) {
    const buf = concat(this.rest, chunk)
    const n = Math.floor(buf.length / this.bytes)
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const at = this.queue.reserve(n), out = this.queue.data
    if (this.bytes === 8) for (let i = 0; i < n; i++) out[at + i] = view.getFloat64(i * 8, true)
    else for (let i = 0; i < n; i++) out[at + i] = view.getFloat32(i * 4, true)
    this.rest = buf.slice(n * this.bytes)
  }
}

/**
 * An integer field: each value minus the minimum in `bits` bits, packed from
 * the lowest bit of each byte up and carried on across packets.
 */
class BitStream {
  constructor({ bits, min, scale, offset }) {
    Object.assign(this, { bits, min, scale, offset })
    this.rest = new Uint8Array(0)
    this.bit = 0   // where the next value starts in rest[0]
    this.queue = new Queue()
  }
  push(chunk) {
    const buf = concat(this.rest, chunk)
    const { bits, min, scale, offset } = this
    const n = Math.floor((buf.length * 8 - this.bit) / bits)
    const at = this.queue.reserve(n), out = this.queue.data
    let p = this.bit
    if (bits <= 24) {
      const mask = (1 << bits) - 1
      for (let i = 0; i < n; i++, p += bits) {
        const b = p >> 3
        const word = buf[b] | (buf[b + 1] << 8) | (buf[b + 2] << 16) | (buf[b + 3] << 24)
        out[at + i] = (((word >>> (p & 7)) & mask) + min) * scale + offset
      }
    } else if (bits <= 32) {
      const span = 2 ** bits
      for (let i = 0; i < n; i++, p += bits) {
        const b = p >> 3, s = p & 7
        const word = (buf[b] | (buf[b + 1] << 8) | (buf[b + 2] << 16) | (buf[b + 3] << 24)) >>> s
        out[at + i] = ((word + (buf[b + 4] ?? 0) * 2 ** (32 - s)) % span + min) * scale + offset
      }
    } else {
      for (let i = 0; i < n; i++) {
        let v = 0, got = 0
        while (got < bits) {
          const s = p & 7, take = Math.min(8 - s, bits - got)
          v += ((buf[p >> 3] >> s) & ((1 << take) - 1)) * 2 ** got
          got += take; p += take
        }
        out[at + i] = (v + min) * scale + offset
      }
    }
    const used = this.bit + n * bits
    this.rest = buf.slice(used >> 3)
    this.bit = used & 7
  }
}

/** The stream of a needed field, or `{ constant }` for an integer of a single value. */
function makeStream(field) {
  if (field.kind === 'float') return new FloatStream(field.bytes)
  if (field.bits === 0) return { constant: field.low }
  return new BitStream(field)
}

const newBatch = (n, rgb = false) => ({
  count: n,
  x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n),
  intensity: new Uint16Array(n),
  ...(rgb ? { red: new Uint16Array(n), green: new Uint16Array(n), blue: new Uint16Array(n) } : {}),
})

/** A value between `lo` and `hi` on 0…65535. */
const to16 = (v, lo, hi) => {
  const s = Math.round((v - lo) * 65535 / (hi - lo))
  return s < 0 ? 0 : s > 65535 ? 65535 : s
}

/**
 * `n` records from the streams as one batch: valid points only, pose applied.
 * With `rgb` the batch has colour columns — black for a scan without colour.
 */
function assemble(scan, streams, n, rgb = false) {
  const col = (k) => {
    if (k == null) return null
    const s = streams.get(k)
    return s.constant != null ? { c: s.constant } : { a: s.queue.data }
  }
  const get = (c, i) => (c.a ? c.a[i] : c.c)
  const [ca, cb, cc] = scan.xyz.map(col)
  const st = col(scan.state), it = col(scan.intensity)
  const cols = rgb && scan.color ? scan.color.map(col) : null
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = scan.rotation
  const [tx, ty, tz] = scan.translation
  const [ilo, ihi] = scan.intensityRange ?? [0, 1]
  const iscale = 65535 / (ihi - ilo)
  const spherical = scan.coords === 'spherical'
  const batch = newBatch(n, rgb)
  let m = 0
  for (let i = 0; i < n; i++) {
    if (st && get(st, i) !== 0) continue
    let x = get(ca, i), y = get(cb, i), z = get(cc, i)
    if (spherical) {
      const r = x, az = y, el = z, h = r * Math.cos(el)
      x = h * Math.cos(az); y = h * Math.sin(az); z = r * Math.sin(el)
    }
    batch.x[m] = r0 * x + r1 * y + r2 * z + tx
    batch.y[m] = r3 * x + r4 * y + r5 * z + ty
    batch.z[m] = r6 * x + r7 * y + r8 * z + tz
    if (it) {
      const v = Math.round((get(it, i) - ilo) * iscale)
      batch.intensity[m] = v < 0 ? 0 : v > 65535 ? 65535 : v
    }
    if (cols) {
      const [rr, gr, br] = scan.colorRange
      batch.red[m] = to16(get(cols[0], i), rr[0], rr[1])
      batch.green[m] = to16(get(cols[1], i), gr[0], gr[1])
      batch.blue[m] = to16(get(cols[2], i), br[0], br[1])
    }
    m++
  }
  batch.count = m
  batch.records = n
  for (const s of streams.values()) if (s.queue) s.queue.drop(n)
  return batch
}

/** Where a scan's packets lie: `{ dataAt, end }` in logical bytes. */
async function openSection(paged, scan) {
  const sectionAt = paged.logical(scan.fileOffset)
  const head = await paged.read(sectionAt, 32)
  const view = new DataView(head.buffer, head.byteOffset, 32)
  if (head[0] !== 1) throw new Error(`E57 scan "${scan.name}": no CompressedVector section`)
  const end = sectionAt + u64(view, 8)
  const dataAt = paged.logical(u64(view, 16))
  if (!(dataAt >= sectionAt + 32 && dataAt <= end)) throw new Error(`E57 scan "${scan.name}": bad section header`)
  return { dataAt, end }
}

/**
 * One scan's points, batch by batch. `window` bounds how much is read at a
 * time; `limit` stops after so many logical bytes (the extent sample).
 * `onBytes(n)` reports the bytes of the section read so far.
 */
async function* scanBatches(paged, scan, { signal, onBytes, window = WINDOW_BYTES, limit = Infinity, rgb = false } = {}) {
  if (!(scan.recordCount > 0)) return
  const { dataAt, end } = await openSection(paged, scan)

  const needed = [...scan.xyz, scan.state, scan.intensity, ...(rgb && scan.color ? scan.color : [])].filter(k => k != null)
  const streams = new Map(needed.map(k => [k, makeStream(scan.fields[k])]))
  const queued = [...streams.values()].filter(s => s.queue)
  let remaining = scan.recordCount
  let at = dataAt
  const stop = Math.min(end, dataAt + limit)
  while (remaining > 0 && at < stop) {
    if (signal?.aborted) throw abortError()
    const buf = await paged.read(at, Math.min(Math.max(window, MAX_PACKET), end - at))
    const bv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    let p = 0
    while (p + 4 <= buf.length) {
      const type = buf[p], length = bv.getUint16(p + 2, true) + 1
      if (p + length > buf.length) break
      if (type === 1) {
        const count = bv.getUint16(p + 4, true)
        let q = p + 6 + 2 * count
        for (let s = 0; s < count; s++) {
          const len = bv.getUint16(p + 6 + 2 * s, true)
          streams.get(s)?.push?.(buf.subarray(q, q + len))
          q += len
        }
        if (q > p + length) throw new Error(`E57 scan "${scan.name}": bad data packet`)
      } else if (type !== 0 && type !== 2) {
        throw new Error(`E57 scan "${scan.name}": unknown packet type ${type}`)
      }
      p += length
    }
    if (p === 0) throw new Error(`E57 scan "${scan.name}": truncated packet`)
    at += p
    onBytes?.(at - dataAt)
    let n = remaining
    for (const s of queued) n = Math.min(n, s.queue.length)
    if (n > 0) {
      remaining -= n
      yield assemble(scan, streams, n, rgb)
    }
  }
  if (remaining > 0 && limit === Infinity) throw new Error(`E57 scan "${scan.name}" ends ${remaining} points early`)
}

// ── the header: what the import dialog and the worker need ───────────────────

const transformBox = (scan, [x0, y0, z0, x1, y1, z1]) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = scan.rotation, t = scan.translation
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const g = [r0 * x + r1 * y + r2 * z + t[0], r3 * x + r4 * y + r5 * z + t[1], r6 * x + r7 * y + r8 * z + t[2]]
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g[k]); max[k] = Math.max(max[k], g[k]) }
  }
  return [...min, ...max]
}

const holds = (box, s) => box[0] - BOX_SLACK <= s[0] && box[1] - BOX_SLACK <= s[1] && box[2] - BOX_SLACK <= s[2]
  && box[3] + BOX_SLACK >= s[3] && box[4] + BOX_SLACK >= s[4] && box[5] + BOX_SLACK >= s[5]

/** The box of the points at the start of a scan (pose applied), or null. */
async function sampleBox(paged, scan) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for await (const b of scanBatches(paged, scan, { window: SAMPLE_BYTES, limit: SAMPLE_BYTES })) {
    for (let i = 0; i < b.count; i++) {
      const p = [b.x[i], b.y[i], b.z[i]]
      for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], p[k]); box[k + 3] = Math.max(box[k + 3], p[k]) }
    }
  }
  return box[0] <= box[3] ? box : null
}

/**
 * What a scan covers in the file's frame. The standard states cartesianBounds
 * in the scan's own frame, but writers differ, so the start of the scan is
 * read and the stated box taken as it fits: turned by the pose, as written,
 * or — when neither holds those points, or there is none — the sample's box
 * widened by the spherical range where one is stated.
 */
async function scanExtent(paged, scan) {
  const sample = await sampleBox(paged, scan)
  const candidates = scan.bounds ? [transformBox(scan, scan.bounds), scan.bounds] : []
  if (scan.rangeMaximum) {
    const r = scan.rangeMaximum, t = scan.translation
    candidates.push([t[0] - r, t[1] - r, t[2] - r, t[0] + r, t[1] + r, t[2] + r])
  }
  if (!sample) return candidates[0] ?? null
  return candidates.find(box => holds(box, sample)) ?? sample
}

/**
 * The header of an E57 file, in the shape lasHeader gives a LAS file's where
 * the import needs it: `pointCount` (records, invalid ones included), `min`
 * and `max` (the scans' extent with their poses), `scale` (the finest
 * coordinate step, for printing) — and `scans` for the reader.
 */
export async function readE57Header(source) {
  if (source.size < HEADER_BYTES) throw new Error('not an E57 file')
  const head = await source.read(0, HEADER_BYTES)
  if (!isE57(head)) throw new Error('not an E57 file')
  const view = new DataView(head.buffer, head.byteOffset, HEADER_BYTES)
  const major = view.getUint32(8, true), minor = view.getUint32(12, true)
  if (major !== 1) throw new Error(`E57 version ${major}.${minor} is not supported`)
  const physicalLength = u64(view, 16), xmlAt = u64(view, 24), xmlLength = u64(view, 32), pageSize = u64(view, 40)
  if (physicalLength > source.size) throw new Error('E57 file is incomplete')
  if (!(pageSize > CHECKSUM_BYTES)) throw new Error('E57 page size is invalid')
  const paged = pagedReader(source, pageSize)
  const xml = new TextDecoder().decode(await paged.read(paged.logical(xmlAt), xmlLength))
  const root = parseXml(xml)
  const data3D = child(root, 'data3D')
  const scans = (data3D?.children ?? []).map(parseScan)
  if (!scans.some(s => s.recordCount > 0)) throw new Error('E57 file holds no points')

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const scan of scans) {
    if (!(scan.recordCount > 0)) continue
    const box = await scanExtent(paged, scan)
    if (!box) continue
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], box[k]); max[k] = Math.max(max[k], box[k + 3]) }
  }
  const steps = scans.flatMap(s => s.xyz.map(k => s.fields[k]))
    .filter(f => f.kind === 'int' && f.scale > 0).map(f => f.scale)
  const step = steps.length ? Math.min(...steps) : 0.001
  return {
    format: 'e57',
    version: `${major}.${minor}`,
    compressed: false,
    pointFormat: null,
    pointCount: scans.reduce((n, s) => n + s.recordCount, 0),
    min, max,
    scale: [step, step, step],
    offset: [0, 0, 0],
    pageSize,
    coordinateMetadata: child(root, 'coordinateMetadata')?.text.trim() || '',
    // Colour only where every scan with points has it: a batch either has
    // colour columns or not, file-wide.
    rgb: scans.some(s => s.recordCount > 0) && scans.every(s => !(s.recordCount > 0) || s.color),
    scans,
  }
}

/**
 * The points of an E57 file, batch by batch, scan after scan (an async
 * generator) — options and progress as readLasPoints'.
 */
export async function* readE57Points(source, header, { onProgress, signal } = {}) {
  const paged = pagedReader(source, header.pageSize)
  const totalPoints = header.pointCount
  // The bytes to go through: the packets of every scan.
  let totalBytes = 0
  for (const scan of header.scans) {
    if (!(scan.recordCount > 0)) continue
    const { dataAt, end } = await openSection(paged, scan)
    totalBytes += end - dataAt
  }
  let done = 0, points = 0
  for (const scan of header.scans) {
    let read = 0
    for await (const batch of scanBatches(paged, scan, { signal, rgb: header.rgb, onBytes: (n) => { read = n } })) {
      points += batch.records
      onProgress?.({ bytes: Math.min(totalBytes, done + read), totalBytes, points, totalPoints })
      yield batch
    }
    done += read
  }
}
