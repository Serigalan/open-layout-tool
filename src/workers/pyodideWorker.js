// Web Worker: runs the Python optimizer (tools/optimizer) in the browser via
// Pyodide. The Python sources are bundled verbatim (?raw) — CLI and browser
// share one implementation. Pyodide + numpy/scipy load lazily from the CDN on
// the first run (~20 MB, cached by the browser afterwards).

import initSrc from '../../tools/optimizer/olt_optimizer/__init__.py?raw'
import geometrySrc from '../../tools/optimizer/olt_optimizer/geometry.py?raw'
import trackIoSrc from '../../tools/optimizer/olt_optimizer/track_io.py?raw'
import optimizeSrc from '../../tools/optimizer/olt_optimizer/optimize.py?raw'
import apiSrc from '../../tools/optimizer/olt_optimizer/api.py?raw'

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/'

const DRIVER = `
import json
from olt_optimizer.api import optimize_payload
_p = json.loads(payload_json)
try:
    _res = optimize_payload(_p["track"], corridor_cm=_p["corridorCm"], uf=_p["uf"],
                            uebergang=_p.get("uebergang", "auto"),
                            maxiter=_p.get("maxiter", 100), seed=_p.get("seed", 1),
                            target_element_idx=_p.get("targetElementIdx"))
    _out = json.dumps({"ok": True, "result": _res})
except ValueError as exc:
    _out = json.dumps({"ok": False, "error": str(exc)})
_out
`

let initPromise = null

// loadPackage does NOT throw on failed downloads (it only logs) — verify the
// imports actually work and retry once before giving up with a clear message.
async function loadSciStack(py) {
  const errors = []
  for (let attempt = 0; attempt < 2; attempt++) {
    await py.loadPackage(['numpy', 'scipy'], { errorCallback: (msg) => errors.push(String(msg)) })
    try {
      py.runPython('import numpy, scipy')
      return
    } catch {
      // retry once (transient CDN/network failure)
    }
  }
  throw new Error('numpy/scipy konnten nicht geladen werden — Netzwerk oder Content-Blocker '
    + 'für cdn.jsdelivr.net prüfen. ' + (errors[errors.length - 1] ?? ''))
}

async function init(post) {
  post('runtime')
  const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_URL + 'pyodide.mjs')
  const py = await loadPyodide({ indexURL: PYODIDE_URL })
  post('packages')
  await loadSciStack(py)
  py.FS.mkdirTree('/olt/olt_optimizer')
  const files = {
    '__init__.py': initSrc,
    'geometry.py': geometrySrc,
    'track_io.py': trackIoSrc,
    'optimize.py': optimizeSrc,
    'api.py': apiSrc,
  }
  for (const [name, src] of Object.entries(files)) {
    py.FS.writeFile('/olt/olt_optimizer/' + name, src)
  }
  py.runPython('import sys; sys.path.insert(0, "/olt")')
  return py
}

self.onmessage = async (e) => {
  if (e.data?.type !== 'optimize') return
  const post = (stage) => self.postMessage({ type: 'status', stage })
  let pyodide
  try {
    initPromise ??= init(post)        // single shared init, race-free
    pyodide = await initPromise
  } catch (err) {
    initPromise = null                // next click retries from scratch
    self.postMessage({ type: 'error', message: 'Pyodide-Laden fehlgeschlagen: ' + String(err?.message ?? err) })
    return
  }
  try {
    post('running')
    pyodide.globals.set('payload_json', JSON.stringify(e.data.payload))
    const out = pyodide.runPython(DRIVER)
    const parsed = JSON.parse(out)
    if (parsed.ok) self.postMessage({ type: 'result', result: parsed.result })
    else self.postMessage({ type: 'error', message: parsed.error })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) })
  }
}
