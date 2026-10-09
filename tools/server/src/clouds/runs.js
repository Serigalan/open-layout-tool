import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { scanClearance } from '../../../../src/core/utils/pointCloud/clearanceScan.js'
import { traceTrack, trackGuide, lineGuide } from '../../../../src/core/utils/pointCloud/railTrace.js'

/** The level long runs read: the 2-cm voxel, as in the browser (AP 13.6). */
const RUN_LEVEL = 1
/** Progress reaches the database, and a cancel is noticed, at most this often [ms]. */
const PROGRESS_EVERY = 1000

/** A tile file on disk as a cloud source (cloudSource's `readMany`). */
function diskSource(path) {
  let fd = null
  const readMany = async (ranges) => {
    fd ??= openSync(path, 'r')
    return ranges.map(([offset, length]) => {
      const buf = Buffer.allocUnsafe(length)
      const got = readSync(fd, buf, 0, length, offset)
      return new Uint8Array(buf.buffer, buf.byteOffset, got)
    })
  }
  return {
    readMany,
    read: async (offset, length) => (await readMany([[offset, length]]))[0],
    close: () => { if (fd != null) closeSync(fd) },
  }
}

/**
 * The clouds a run reads, as cloudSection takes them: the index of their
 * voxel level with a source over its tile file, and the re-referencing in
 * force (AP 13.15) — the run reads what the browser would. A cloud deleted
 * since the run was queued, or one in a local system without a
 * re-referencing, is left out; none left fails the run.
 */
function runClouds({ run, clouds, storage }) {
  const out = []
  for (const id of JSON.parse(run.clouds || '[]')) {
    const c = clouds.get(id)
    if (!c || c.project_id !== run.project_id || c.status !== 'ready') continue
    const index = storage.index(c.project_id, c.id, RUN_LEVEL)
    if (!existsSync(index)) continue
    const t = clouds.activeTransform(c.id)
    const transform = t ? { id: t.id, matrix: JSON.parse(t.matrix), crs: JSON.parse(t.params).crs } : null
    if (c.crs == null && !transform) continue
    out.push({
      ...JSON.parse(readFileSync(index, 'utf8')), id: c.id, transform,
      source: diskSource(storage.tiles(c.project_id, c.id, RUN_LEVEL)),
    })
  }
  if (!out.length) throw new Error('none of the clouds is there any more')
  return out
}

/** The guide a trace walks, from what the browser sent (railTrace's guides). */
function guideOf(g) {
  if (g?.kind === 'track') return trackGuide(g.track)
  if (g?.kind === 'line') return lineGuide(g.vertices, g.epsg)
  throw new Error('unknown guide')
}

/**
 * One long run (AP 13.7): the same code the browser runs (clearanceScan,
 * railTrace) over the project's clouds on this disk. Progress goes to the
 * database; a run cancelled there stops at its next step. Resolves with what
 * was found, or `null` when it was cancelled.
 */
export async function executeRun({ runId, runs, clouds, storage, log = () => {} }) {
  const run = runs.get(runId)
  if (!run) throw new Error('run gone')
  const params = JSON.parse(run.params)
  const list = runClouds({ run, clouds, storage })
  const ctl = { aborted: false }
  let last = 0
  const onProgress = (share) => {
    const t = Date.now()
    if (t - last < PROGRESS_EVERY) return
    last = t
    if (runs.get(runId)?.status !== 'running') { ctl.aborted = true; return }
    runs.setProgress(runId, share)
  }
  const started = Date.now()
  try {
    let result
    if (run.kind === 'clearance') {
      result = await scanClearance({
        projectId: run.project_id, clouds: list, track: params.track, tracks: params.tracks, switches: params.switches,
        ring: params.ring, areas: params.areas, from: params.from ?? 0, to: params.to ?? null,
        signal: ctl, onProgress,
      })
    } else if (run.kind === 'trace') {
      result = await traceTrack({
        projectId: run.project_id, clouds: list, guide: guideOf(params.guide), rail: params.rail,
        signal: ctl, onProgress,
      })
    } else {
      throw new Error(`unknown run ${run.kind}`)
    }
    if (!runs.done(runId, result)) return null
    log(`run ${runId} (${run.kind}) done in ${((Date.now() - started) / 1000).toFixed(0)} s`)
    return result
  } catch (err) {
    if (err?.name === 'AbortError') return null
    throw err
  } finally {
    for (const c of list) c.source.close()
  }
}
