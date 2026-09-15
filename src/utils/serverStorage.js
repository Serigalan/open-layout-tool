// Client for the shared project store (api/projects.php).
//
// Reading the store is open to everyone; putting a project there and removing
// one carry the shared password. The password is never checked here — a check
// in the bundle would sit in the delivered JavaScript for anyone to read — it
// only travels to the endpoint, which holds the hash and decides.

const API = import.meta.env.VITE_OLT_API ?? 'api/projects.php'

/** A failed request, `code` being the server's error key for the UI to translate. */
export class ServerError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ServerError'
    this.code = code
  }
}

// Header values are bytes, so the password goes over as base64 of its UTF-8
// form — otherwise one with umlauts would arrive in a different encoding than
// the one the hash was made from. It is transport encoding, not protection;
// what protects it is that the site is served over https.
function passwordHeader(password) {
  const bytes = new TextEncoder().encode(password)
  return { 'X-OLT-Password': btoa(String.fromCharCode(...bytes)) }
}

async function request(url, options = {}) {
  let res
  try {
    res = await fetch(url, options)
  } catch {
    throw new ServerError('unavailable')   // offline, DNS, TLS, blocked by CORS
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null                            // not JSON — the host's own error page
  }
  if (!res.ok) throw new ServerError(data?.error ?? (res.status === 404 ? 'not_found' : 'unavailable'))
  if (data === null) throw new ServerError('unavailable')
  return data
}

/** What lies on the server: [{ id, title, tracks, size, updated }], newest first. */
export async function listServerProjects() {
  const { projects } = await request(API)
  return Array.isArray(projects) ? projects : []
}

/** One project as an export payload ({ version, projects: [ … ] }). */
export function fetchServerProject(id) {
  return request(`${API}?id=${encodeURIComponent(id)}`)
}

/** Put a project there — same id replaces what is already stored. */
export function uploadServerProject(id, payload, password) {
  return request(`${API}?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...passwordHeader(password) },
    body: JSON.stringify(payload),
  })
}

export function deleteServerProject(id, password) {
  return request(`${API}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: passwordHeader(password),
  })
}
