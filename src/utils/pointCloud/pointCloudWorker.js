// The point cloud import, off the main thread: a file of gigabytes takes
// minutes, and the page stays usable meanwhile. Messages in:
//   { type: 'import', file, projectId, cloudId, meta, sourceCrs, targetCrs, original, base }
//   { type: 'abort' }
// and out: { type: 'progress', … }, { type: 'done', index }, { type: 'aborted' },
// { type: 'error', message }.
//   { type: 'preview', file, count } answers { type: 'preview', header, points }
// with the file's first points, read without importing anything (lasText).
//
// Tiles are written through a synchronous access handle — the fast OPFS path,
// and one only a worker may hold. An import that does not finish removes its
// directory again: an aborted import leaves nothing.
import { loadLazPerf } from './lazPerfBrowser'
import { fileSource } from './lasReader'
import { readCloudHeader, readFirstPoints } from './cloudReader'
import { importPointCloud } from './importPipeline'
import { planeMapper } from './cloudCrs'
import { projectDir, INDEX_FILE, TILES_FILE } from './cloudStore'
import { loadNtv2Grid, loadGridsFor } from '../ntv2Grid'
import { crsDatum, utmToWgs84 } from '../coordinateUtils'

let controller = null

/** Progress is posted at most this often [ms]. */
const PROGRESS_EVERY = 250

async function runImport({ file, projectId, cloudId, meta, sourceCrs, targetCrs: wanted, original = false, base }) {
  // The original resolution stays in the file's plane (Entscheidung 145).
  const targetCrs = original ? sourceCrs : wanted
  controller = new AbortController()
  const { signal } = controller
  const dir = await projectDir(projectId, true)
  const cloudDir = await dir.getDirectoryHandle(cloudId, { create: true })
  let tiles = null
  try {
    // The grids the conversion runs on — the same the page loaded at start,
    // and the regional one the cloud's area may have.
    await loadNtv2Grid({ base })
    const source = fileSource(file)
    const header = await readCloudHeader(source)
    if (Number(sourceCrs) !== Number(targetCrs)) {
      const datums = [crsDatum(sourceCrs), crsDatum(targetCrs)].filter(Boolean)
      if (datums.length) {
        const [w, s] = utmToWgs84(header.min[0], header.min[1], sourceCrs)
        const [e, n] = utmToWgs84(header.max[0], header.max[1], sourceCrs)
        await loadGridsFor([Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)], datums, { base })
      }
    }
    const lazPerf = header.compressed ? await loadLazPerf() : null

    tiles = await (await cloudDir.getFileHandle(TILES_FILE, { create: true })).createSyncAccessHandle()
    let at = 0
    const writer = {
      append(bytes) {
        const offset = at
        tiles.write(bytes, { at })
        at += bytes.length
        return offset
      },
    }
    let lastPost = 0
    const body = await importPointCloud({
      source, header, lazPerf, writer, signal, original,
      mapper: planeMapper(sourceCrs, targetCrs),
      onProgress: (p) => {
        const now = Date.now()
        if (now - lastPost < PROGRESS_EVERY && p.points < p.totalPoints) return
        lastPost = now
        self.postMessage({ type: 'progress', ...p })
      },
    })
    tiles.flush()
    tiles.close()
    tiles = null

    const index = {
      ...meta, ...body,
      crs: Number(targetCrs), sourceCrs: Number(sourceCrs),
      file: header.format === 'e57'
        ? { name: file.name, size: file.size, format: 'e57', e57Version: header.version, scans: header.scans.length }
        : { name: file.name, size: file.size, lasVersion: header.version, pointFormat: header.pointFormat },
      createdAt: new Date().toISOString(),
    }
    const indexHandle = await (await cloudDir.getFileHandle(INDEX_FILE, { create: true })).createSyncAccessHandle()
    const json = new TextEncoder().encode(JSON.stringify(index))
    indexHandle.truncate(0)
    indexHandle.write(json, { at: 0 })
    indexHandle.flush()
    indexHandle.close()
    self.postMessage({ type: 'done', index: { ...index, id: cloudId } })
  } catch (err) {
    try { tiles?.close() } catch { /* already closed */ }
    await dir.removeEntry(cloudId, { recursive: true }).catch((e) => console.error('pointcloud cleanup failed', e))
    if (err?.name === 'AbortError') self.postMessage({ type: 'aborted' })
    else self.postMessage({ type: 'error', message: String(err?.message ?? err) })
  } finally {
    controller = null
  }
}

async function runPreview({ file, count }) {
  try {
    const source = fileSource(file)
    const header = await readCloudHeader(source)
    const lazPerf = header.compressed ? await loadLazPerf() : null
    const points = await readFirstPoints(source, header, count, { lazPerf })
    self.postMessage({ type: 'preview', header, points })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) })
  }
}

self.onmessage = ({ data }) => {
  if (data?.type === 'abort') controller?.abort()
  else if (data?.type === 'import') runImport(data)
  else if (data?.type === 'preview') runPreview(data)
}
