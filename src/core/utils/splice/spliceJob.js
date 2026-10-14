import { solveSplice } from './solveSplice'

// One worker for the splice dialog, kept between requests. A request given up
// (`signal`) while the worker still computes it takes the worker with it — a
// computation cannot be stopped otherwise — and every other request then
// waiting fails with it; the next request starts a fresh worker.
let worker = null
const waiting = new Map()   // id → { resolve, reject }
let next = 0

function stopWorker(error) {
  worker?.terminate()
  worker = null
  for (const { reject } of waiting.values()) reject(error)
  waiting.clear()
}

function startWorker() {
  worker = new Worker(new URL('./spliceWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const job = waiting.get(e.data.id)
    if (!job) return
    waiting.delete(e.data.id)
    if (e.data.ok) job.resolve(e.data.answer)
    else job.reject(new Error(e.data.message))
  }
  worker.onerror = (e) => stopWorker(new Error(e.message || 'worker failed'))
}

/**
 * The answer to a splice request (solveSplice), computed in a worker so the
 * page stays responsive. Rejects with an AbortError when `signal` aborts.
 * Where workers are not to be had (the tests) it runs in place.
 */
export function solveSpliceInWorker(request, { signal } = {}) {
  if (typeof Worker === 'undefined') return Promise.resolve(solveSplice(request))
  if (signal?.aborted) return Promise.reject(new DOMException('stopped', 'AbortError'))
  if (!worker) startWorker()
  const id = ++next
  return new Promise((resolve, reject) => {
    const abort = () => {
      if (waiting.has(id)) stopWorker(new DOMException('stopped', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    const done = (fn) => (value) => { signal?.removeEventListener('abort', abort); fn(value) }
    waiting.set(id, { resolve: done(resolve), reject: done(reject) })
    worker.postMessage({ id, request })
  })
}
