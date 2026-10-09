import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createLazPerf } from 'laz-perf'
import { readCloudHeader } from '../../../../src/core/utils/pointCloud/cloudReader.js'
import { importLevels } from '../../../../src/core/utils/pointCloud/importPipeline.js'
import { LEVELS } from '../../../../src/core/utils/pointCloud/tiles.js'

/** Progress reaches the database at most this often [ms]. */
const PROGRESS_EVERY = 2000

/** A reader source over a file on disk, the way fileSource is one over a browser File. */
async function fileSource(path) {
  const fh = await open(path)
  const { size } = await fh.stat()
  return {
    size,
    read: async (offset, length) => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fh.read(buf, 0, length, offset)
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead)
    },
    close: () => fh.close(),
  }
}

/** A tile file written segment after segment; append returns the offset. */
function fileWriter(path) {
  const fd = openSync(path, 'w')
  let at = 0
  return {
    append(bytes) {
      const offset = at
      writeSync(fd, bytes, 0, bytes.length, at)
      at += bytes.length
      return offset
    },
    close() { fsyncSync(fd); closeSync(fd) },
  }
}

const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/**
 * The preparation of one uploaded cloud (AP 13.3, 13.4): its file read once,
 * all five levels of detail written, each with its index — the tiles in the
 * file's own plane (decision 205). The same reading and tiling code as the
 * browser's import (importPipeline), with laz-perf's Node build. Unless the
 * raw file is to be kept, it is deleted afterwards (decision 207).
 *
 * `clouds` is the cloud store, `storage` the cloud directories. A cloud
 * deleted meanwhile stops the job; what it wrote goes with the directory.
 */
export async function prepareCloud({ cloudId, clouds, storage, log = () => {} }) {
  const c = clouds.get(cloudId)
  if (!c) throw new Error('cloud gone')
  const raw = storage.raw(c.project_id, c.id)
  if (!existsSync(raw)) throw new Error('the uploaded file is gone')
  clouds.setStatus(c.id, 'processing', { progress: 0 })
  const source = await fileSource(raw)
  const writers = {}
  const signal = { aborted: false }
  let lastSaved = 0
  try {
    const header = await readCloudHeader(source)
    const lazPerf = header.compressed ? await createLazPerf() : null
    const levels = LEVELS.map(l => l.level)
    for (const level of levels) writers[level] = fileWriter(`${storage.tiles(c.project_id, c.id, level)}.part`)
    const started = Date.now()
    const body = await importLevels({
      source, header, lazPerf, writers, levels, signal,
      onProgress: (p) => {
        const now = Date.now()
        if (now - lastSaved < PROGRESS_EVERY) return
        lastSaved = now
        if (!clouds.get(c.id)) { signal.aborted = true; return }
        clouds.setProgress(c.id, p.totalBytes ? p.bytes / p.totalBytes : 0)
      },
    })
    if (signal.aborted || !clouds.get(c.id)) throw aborted()
    for (const w of Object.values(writers)) w.close()

    const file = header.format === 'e57'
      ? { name: c.file_name, size: c.file_size, format: 'e57', e57Version: header.version, scans: header.scans.length }
      : { name: c.file_name, size: c.file_size, format: c.format, lasVersion: header.version, pointFormat: header.pointFormat }
    const summary = []
    let bytes = 0
    for (const level of levels) {
      const tiles = storage.tiles(c.project_id, c.id, level)
      renameSync(`${tiles}.part`, tiles)
      const index = {
        ...body[level], id: c.id, name: c.name, crs: c.crs, sourceCrs: c.crs, heightEpsg: c.height_epsg, file,
        createdAt: c.created_at,
      }
      writeFileSync(storage.index(c.project_id, c.id, level), JSON.stringify(index))
      summary.push({ level, points: index.points, bytes: index.bytes, tiles: index.tiles.length, segments: index.segments })
      bytes += index.bytes
    }
    clouds.setReady(c.id, {
      points: body[1].points, bytes, rgb: body[1].rgb, bounds: body[1].bounds, levels: summary,
    })
    log(`cloud ${c.id}: ${header.pointCount} points in ${((Date.now() - started) / 1000).toFixed(0)} s, ${bytes} bytes of tiles`)
    if (!c.keep_raw) rmSync(raw, { force: true })
  } catch (err) {
    for (const w of Object.values(writers)) { try { w.close() } catch { /* closed already */ } }
    for (const level of LEVELS.map(l => l.level)) rmSync(`${storage.tiles(c.project_id, c.id, level)}.part`, { force: true })
    if (!clouds.get(c.id)) storage.remove(c.project_id, c.id)
    throw err
  } finally {
    await source.close()
  }
}
