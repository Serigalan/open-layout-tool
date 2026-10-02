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

  users:          () => request('GET', '/admin/users'),
  createUser:     (body) => request('POST', '/admin/users', body),
  patchUser:      (id, body) => request('PATCH', `/admin/users/${enc(id)}`, body),
}

/** A data URL (from a file input) as { mime, data } for uploadImage. */
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl ?? '')
  return m ? { mime: m[1], data: m[2] } : null
}
