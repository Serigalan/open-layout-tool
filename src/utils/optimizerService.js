// Client for the server service (tools/optimizer, olt_optimizer/service.py) —
// the optimizer and, on a second endpoint, the Access-file conversion for the
// MDB import.
//
// The optimizer runs on the server and nowhere else — there is no second
// implementation in this bundle to fall back on. So every failure here is one
// the panel has to say out loud, which is what `code` is for: the service names
// what went wrong, the UI translates the name.

const SERVICE = import.meta.env.VITE_OLT_OPTIMIZER ?? 'https://online.open-layout-tool.org/optimizer'

/** A failed run, `code` being the service's error key for the UI to translate. */
export class OptimizerError extends Error {
  constructor(code, detail) {
    super(detail || code)
    this.name = 'OptimizerError'
    this.code = code
    this.detail = detail
  }
}

/** Is the service there? Answers false rather than throwing — the panel asks
 *  this to decide whether to offer the run at all. */
export async function optimizerReachable() {
  try {
    const res = await fetch(`${SERVICE}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Optimize one track.
 * payload: { track, corridorCm, uf, uebergang?, maxiter?, seed?, targetElementIdx? }
 * Resolves with { elements, report, variant, vBestand, vBaseline, vNeu, shifts }.
 */
export async function optimizeOnServer(payload, { signal } = {}) {
  let res
  try {
    res = await fetch(`${SERVICE}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new OptimizerError('unavailable')   // offline, DNS, TLS, blocked by CORS
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null                               // not JSON — the host's own error page
  }
  if (!res.ok) throw new OptimizerError(data?.error ?? 'unavailable', data?.message)
  if (data === null) throw new OptimizerError('unavailable')
  return data
}

/**
 * Convert an Access file (MDB) into the Satzarten the MDB import reads.
 *
 * The file is sent as it is, not as a form upload — the service takes the raw
 * body, writes it to a temp file, converts and deletes it again. It is a whole
 * database and can be tens of megabytes, so the caller is expected to say so in
 * the UI before this runs: the file leaves the user's machine.
 *
 * Resolves with { points, elements, cants, tracks, nodes, counts }.
 */
export async function convertMdbOnServer(file, { signal } = {}) {
  let res
  try {
    res = await fetch(`${SERVICE}/mdb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new OptimizerError('unavailable')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) throw new OptimizerError(data?.error ?? 'unavailable', data?.message)
  if (data === null) throw new OptimizerError('unavailable')
  return data
}
