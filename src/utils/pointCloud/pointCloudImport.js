/**
 * Starting an import from the page: one worker per import
 * (pointCloudWorker), ended once it has answered. `done` resolves to
 * `{ status: 'done', index }` or `{ status: 'aborted' }` and rejects on an
 * error; `abort()` stops it at the next chunk, and the worker clears away what
 * it had written.
 */
export function startImport({ file, projectId, meta, sourceCrs, targetCrs, onProgress }) {
  const worker = new Worker(new URL('./pointCloudWorker.js', import.meta.url), { type: 'module' })
  const cloudId = crypto.randomUUID()
  const done = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { onProgress?.(data); return }
      worker.terminate()
      if (data.type === 'done') resolve({ status: 'done', index: data.index })
      else if (data.type === 'aborted') resolve({ status: 'aborted' })
      else reject(new Error(data.message))
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'worker failed')) }
  })
  worker.postMessage({
    type: 'import', file, projectId: String(projectId), cloudId, meta, sourceCrs, targetCrs,
    base: document.baseURI,
  })
  return { cloudId, done, abort: () => worker.postMessage({ type: 'abort' }) }
}

/**
 * The first `count` points of a file, read in a worker of their own (LAZ needs
 * laz-perf, which runs in the worker build): resolves to `{ header, points }`.
 */
export function previewPoints(file, count) {
  const worker = new Worker(new URL('./pointCloudWorker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.type === 'preview') resolve({ header: data.header, points: data.points })
      else reject(new Error(data.message))
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'worker failed')) }
    worker.postMessage({ type: 'preview', file, count })
  })
}
