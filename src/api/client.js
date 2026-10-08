/**
 * The project server's API (phase 10), same origin as the app: the session is
 * an HttpOnly cookie the browser sends by itself, and every writing request
 * says it carries JSON (the server refuses it otherwise).
 *
 * A 401 anywhere but on signing in means the session is gone: the handler set
 * with setUnauthorizedHandler takes the app back to the sign-in page.
 */
const BASE = import.meta.env?.VITE_OLT_API ?? '/api'

export class ApiError extends Error {
  constructor(status, code, body) {
    super(code ?? `http_${status}`)
    this.status = status
    this.code = code ?? `http_${status}`
    this.body = body ?? {}
  }
}

let onUnauthorized = null
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

async function request(method, path, body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    })
  } catch {
    throw new ApiError(0, 'offline')
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/login' && path !== '/me') onUnauthorized?.()
    throw new ApiError(res.status, data.error, data)
  }
  return data
}

const enc = encodeURIComponent

/** The URL an image of the server is shown from. */
export const blobUrl = (hash) => (hash ? `${BASE}/blobs/${enc(hash)}` : null)

export const api = {
  me:             () => request('GET', '/me'),
  login:          (login, password) => request('POST', '/login', { login, password }),
  logout:         () => request('POST', '/logout'),
  changePassword: (current, next) => request('POST', '/me/password', { current, next }),

  projects:       () => request('GET', '/projects'),
  createProject:  (body) => request('POST', '/projects', body),
  patchProject:   (id, body) => request('PATCH', `/projects/${enc(id)}`, body),
  deleteProject:  (id) => request('DELETE', `/projects/${enc(id)}`),
  branch:         (projectId, body) => request('POST', `/projects/${enc(projectId)}/variants`, body),
  members:        (projectId) => request('GET', `/projects/${enc(projectId)}/members`),
  addMember:      (projectId, userId) => request('POST', `/projects/${enc(projectId)}/members`, { userId }),
  removeMember:   (projectId, userId) => request('DELETE', `/projects/${enc(projectId)}/members/${enc(userId)}`),
  searchUsers:    (q) => request('GET', `/users?q=${enc(q)}`),

  variant:        (id) => request('GET', `/variants/${enc(id)}`),
  patchVariant:   (id, body) => request('PATCH', `/variants/${enc(id)}`, body),
  head:           (id) => request('GET', `/variants/${enc(id)}/head`),
  history:        (id) => request('GET', `/variants/${enc(id)}/revisions`),
  revision:       (id) => request('GET', `/revisions/${enc(id)}`),
  commonBase:     (a, b) => request('GET', `/revisions/${enc(a)}/base/${enc(b)}`),
  remaps:         (head, base) => request('GET', `/revisions/${enc(head)}/remaps${base != null ? `?base=${enc(base)}` : ''}`),

  /**
   * Check a record in on top of `base`. Resolves { revision } — or
   * { stale: head } when someone else checked in first (409), which the
   * caller answers by merging, not as an error.
   */
  async checkIn(variantId, body) {
    try {
      return await request('POST', `/variants/${enc(variantId)}/revisions`, body)
    } catch (err) {
      if (err.status === 409 && err.code === 'stale_base') return { stale: err.body.head }
      throw err
    }
  },

  uploadImage:    (mime, data) => request('PUT', '/blobs', { mime, data }),

  // Point clouds on the server (phase 13).
  clouds:         (projectId) => request('GET', `/projects/${enc(projectId)}/clouds`),
  createCloud:    (projectId, body) => request('POST', `/projects/${enc(projectId)}/clouds`, body),
  completeCloud:  (projectId, cloudId) => request('POST', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/complete`),
  retryCloud:     (projectId, cloudId) => request('POST', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/retry`),
  deleteCloud:    (projectId, cloudId) => request('DELETE', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}`),
  cloudIndex:     (projectId, cloudId, level) => request('GET', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/L${level}/index`),
  cloudAdmin:     () => request('GET', '/admin/clouds'),
  // Re-referencing a cloud on the server (AP 13.13–13.14).
  cloudTransforms: (projectId, cloudId) => request('GET', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/transforms`),
  saveCloudTransform: (projectId, cloudId, body) => request('POST', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/transforms`, body),
  activateCloudTransform: (projectId, cloudId, id) =>
    request('POST', `/projects/${enc(projectId)}/clouds/${enc(cloudId)}/transforms/active`, { id }),
  // Long runs over the project's clouds on the server (AP 13.7).
  runs:           (projectId) => request('GET', `/projects/${enc(projectId)}/runs`),
  run:            (projectId, runId) => request('GET', `/projects/${enc(projectId)}/runs/${enc(runId)}`),
  startRun:       (projectId, body) => request('POST', `/projects/${enc(projectId)}/runs`, body),
  cancelRun:      (projectId, runId) => request('DELETE', `/projects/${enc(projectId)}/runs/${enc(runId)}`),

  /**
   * One piece of a cloud upload at `offset`, with its SHA-256 (hex): resolves
   * `{ received }` — the server's mark, also when it already had the piece or
   * wants another offset (409).
   */
  async uploadCloudPiece(projectId, cloudId, offset, bytes, sha256) {
    let res
    try {
      res = await fetch(`${BASE}/projects/${enc(projectId)}/clouds/${enc(cloudId)}/raw?offset=${offset}`, {
        method: 'PUT', credentials: 'same-origin', body: bytes,
        headers: { 'content-type': 'application/octet-stream', 'x-olt-upload': '1', 'x-olt-sha256': sha256, accept: 'application/json' },
      })
    } catch {
      throw new ApiError(0, 'offline')
    }
    const data = await res.json().catch(() => ({}))
    if (res.ok) return data
    if (res.status === 409 && Number.isInteger(data.received)) return { received: data.received }
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(res.status, data.error, data)
  },

  /** The bytes of `ranges` (`[[offset, length], …]`, at most 64) of a level's tile file, back to back. */
  async cloudRanges(projectId, cloudId, level, ranges) {
    let res
    try {
      res = await fetch(`${BASE}/projects/${enc(projectId)}/clouds/${enc(cloudId)}/L${level}/ranges`, {
        method: 'POST', credentials: 'same-origin', body: JSON.stringify({ ranges }),
        headers: { 'content-type': 'application/json', accept: 'application/octet-stream' },
      })
    } catch {
      throw new ApiError(0, 'offline')
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) onUnauthorized?.()
      throw new ApiError(res.status, data.error, data)
    }
    return new Uint8Array(await res.arrayBuffer())
  },

  users:          () => request('GET', '/admin/users'),
  createUser:     (body) => request('POST', '/admin/users', body),
  patchUser:      (id, body) => request('PATCH', `/admin/users/${enc(id)}`, body),
}

/** A data URL (from a file input) as { mime, data } for uploadImage. */
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl ?? '')
  return m ? { mime: m[1], data: m[2] } : null
}
