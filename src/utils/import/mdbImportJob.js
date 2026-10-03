import { runMdbImport } from './mdbPipeline'
import { loadRegionalGrids, loadedRegionalGrids } from '../ntv2Grid'

/**
 * runMdbImport in a worker, so the page stays responsive while a database is
 * built (R9.3). Takes what runMdbImport takes, `fill` included, and resolves
 * to its result with the notes translated. The worker starts with the grids
 * the page has, and the page takes over the ones the worker had to load, so
 * both go on converting alike. Where workers are not to be had (the tests) it
 * runs in place.
 */
export async function importMdb({ fill, ...args }) {
  if (typeof Worker === 'undefined') return runMdbImport({ ...args, fill })
  const worker = new Worker(new URL('./mdbWorker.js', import.meta.url), { type: 'module' })
  try {
    const reply = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(e.message || 'worker failed'))
      worker.postMessage({ ...args, base: document.baseURI, grids: loadedRegionalGrids().map(g => g.key) })
    })
    if (!reply.ok) throw new Error(reply.message)
    await loadRegionalGrids(reply.grids, { base: document.baseURI })
    const { result } = reply
    return { ...result, notes: result.notes.map(n => (typeof n === 'string' ? n : fill(n.key, n.params))) }
  } finally {
    worker.terminate()
  }
}
