// Bridge to the Pyodide optimizer worker (see src/workers/pyodideWorker.js).

let _worker = null

/**
 * Run the Python optimizer on a track.
 * payload: { track, corridorCm, uf, uebergang?, maxiter?, seed? }
 * onStatus: called with 'runtime' | 'packages' | 'running'.
 * Resolves with { elements, report, variant, vBestand, vBaseline, vNeu, shifts }.
 */
export function optimizeWithPython(payload, onStatus) {
  return new Promise((resolve, reject) => {
    if (!_worker) {
      _worker = new Worker(new URL('../workers/pyodideWorker.js', import.meta.url), { type: 'module' })
    }
    const worker = _worker
    const onMessage = (e) => {
      if (e.data?.type === 'status') {
        onStatus?.(e.data.stage)
        return
      }
      worker.removeEventListener('message', onMessage)
      if (e.data?.type === 'result') resolve(e.data.result)
      else reject(new Error(e.data?.message ?? 'Optimierung fehlgeschlagen'))
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ type: 'optimize', payload })
  })
}
