// Client for the server service (tools/optimizer, olt_optimizer/service.py) —
// the optimizer and, on endpoints of their own, the Access-file conversion for
// the MDB import and the Länder's DGM1 terrain.
//
// The optimizer runs on the server and nowhere else — there is no second
// implementation in this bundle to fall back on. So every failure here is one
// the panel has to say out loud, which is what `code` is for: the service names
// what went wrong, the UI translates the name.

import { bundledCatalogHash } from './catalogHash'

// The service sits on the app's own origin under /optimizer/ (behind the
// sign-in, see deploy/Caddyfile.template); `npm run dev` proxies the same path.
const SERVICE = import.meta.env.VITE_OLT_OPTIMIZER ?? '/optimizer'

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
 * The rule catalogues the service can hold a run to (AP R.3), as
 * { regelwerke: [{ id, name, version }, ...], drift } — `version` the
 * catalogue's own katalog_version — not their limits, only enough to fill a
 * selector. `drift` is true when the service reads other catalogue files than
 * this bundle carries (R0.1: its `catalogHash` differs from ours), false when
 * they agree, null when the service did not say.
 * Resolves with an empty list where the service cannot be asked, same as
 * `optimizerReachable`'s false: a panel offering a run at all has already
 * found the service, so this failing too is nothing new to say twice.
 */
export async function fetchRegelwerke() {
  const none = { regelwerke: [], drift: null }
  try {
    const res = await fetch(`${SERVICE}/regelwerke`, { method: 'GET' })
    if (!res.ok) return none
    const data = await res.json()
    const regelwerke = Array.isArray(data?.regelwerke) ? data.regelwerke : []
    const drift = typeof data?.catalogHash === 'string'
      ? data.catalogHash !== await bundledCatalogHash()
      : null
    return { regelwerke, drift }
  } catch {
    return none
  }
}

/**
 * What a run under one catalogue is held to, per level: { id, name, version,
 * grenzwerte: { reg, discretion } } — the numbers the regelwerk popup sets
 * beside the app's own. Resolves with null where the id is unknown or the
 * service cannot be asked, for the same reason `fetchRegelwerke` resolves
 * with [].
 */
export async function fetchRegelwerk(id) {
  try {
    const res = await fetch(`${SERVICE}/regelwerke/${encodeURIComponent(id)}`, { method: 'GET' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Optimize one track.
 * payload: { track, corridorCm, grenzwert?, uebergang?, maxiter?, seed?,
 *            targetElementIdx?, vMax?, regelwerk? } — grenzwert is the level
 *            of the rulebook the run is held to, 'reg' (Regelwert, the
 *            default) or 'discretion' (Ermessensgrenze). vMax is the line's
 *            design speed; above it there is nothing to optimize, so the run
 *            neither pushes past it nor moves the alignment for speed nobody
 *            asked for. regelwerk is an id from fetchRegelwerke(); omitted,
 *            the service uses its default.
 * Resolves with { elements, report, variant, vBestand, vBaseline, vNeu, shifts,
 * skipped, regelwerk, regelwerkVersion, grenzwert }, `skipped` naming the
 * stretches the parser could not read and the last three what the run was
 * actually held to.
 */
export async function optimizeOnServer(payload, { signal } = {}) {
  return postJson('/optimize', payload, { signal })
}

/**
 * "Elemente verbinden" (AP 12.4): the chain between two picked elements, built
 * by the service — the only place the construction lives. Resolves with
 * { elements, reverseArr, info }, or { error, params } where the splice does
 * not fit (an answer, not a failure: `error` is the key the panel translates,
 * `params.rMax` the largest radius that would). Throws an OptimizerError where
 * the service cannot be asked.
 */
export async function spliceOnServer(payload, { signal } = {}) {
  return postJson('/splice', payload, { signal })
}

/**
 * "Bestehende Elemente neu verbinden" (Paket N): the best splices between the
 * two neighbours of a stretch within a tolerance of its old axis — see
 * commands/reconnect.reconnectRequest for the payload. Nothing that fits is an
 * answer with `error`; throws an OptimizerError where the service cannot be asked.
 */
export async function reconnectOnServer(payload, { signal } = {}) {
  return postJson('/reconnect', payload, { signal })
}

/**
 * "Aus Messachse trassieren" (AP 12.5): an alignment from axis points, fitted
 * by the service — curvature, straights, curves, the chain and every point's
 * offset from it. See alignmentFit.alignRequest for the payload. A fit that
 * cannot be made is an answer with `error` (and `errorParams`), the curvature
 * and the straights still in it; throws an OptimizerError where the service
 * cannot be asked.
 */
export async function alignOnServer(payload, { signal } = {}) {
  return postJson('/align', payload, { signal })
}

/** A JSON request to the service and its answer; every failure an OptimizerError. */
async function postJson(path, payload, { signal } = {}) {
  let res
  try {
    res = await fetch(`${SERVICE}${path}`, {
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
 * Ground heights from the Länder's DGM1, which only the service can read (the
 * Länder publish tiles without a CORS header). `lngLats` are WGS84
 * [[lng, lat], ...].
 *
 * Resolves with { heights, sources } — per point the height [m] and the dataset
 * it came from, both null where no DGM1 has the point. Never throws: the
 * terrain has sources to fall back on, so a service that cannot be asked, or
 * does not answer within `timeoutMs`, answers null for every point, like one
 * that has no data there.
 */
export async function terrainOnServer(lngLats, { timeoutMs = 60000 } = {}) {
  const none = { heights: lngLats.map(() => null), sources: lngLats.map(() => null) }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const res = await fetch(`${SERVICE}/terrain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lnglat: lngLats }),
      signal: abort.signal,
    })
    if (!res.ok) return none
    const data = await res.json()
    if (!Array.isArray(data?.heights) || data.heights.length !== lngLats.length) return none
    return { heights: data.heights, sources: data.sources ?? none.sources }
  } catch {
    return none
  } finally {
    clearTimeout(timer)
  }
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
