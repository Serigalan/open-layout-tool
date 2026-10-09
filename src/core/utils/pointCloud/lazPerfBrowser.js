// laz-perf in the browser: the worker build (the web build refuses to start
// inside a Worker), its WASM served as an asset of its own, so Vite hashes it
// with the rest of the build and the module finds it under the app's base.
import { createLazPerf } from 'laz-perf/lib/worker/index.js'
import wasmUrl from 'laz-perf/lib/worker/laz-perf.wasm?url'

let pending = null

/** The laz-perf module, created once per worker. */
export function loadLazPerf() {
  pending ??= createLazPerf({ locateFile: () => wasmUrl })
  return pending
}
