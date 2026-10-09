import { REPORT_KEY_PREFIX, HIDDEN_KEY_PREFIX, forgetHiddenTracks } from './storage'
import { extensionsOf } from './extensions'
import { SETTINGS_KEY } from './utils/settings'
import { INDEX_FILE, opfsAvailable, storageEstimate, storagePersisted } from './utils/pointCloud/cloudStore'
import { forgetAllClouds, forgetCloud } from './utils/pointCloud/cloudSection'
import { forgetCache } from './utils/pointCloud/cloudCache'
import { formatNum } from './locales/i18n'

/**
 * What this browser keeps for the app, and taking it away again — the local
 * storage dialog of the start page. Two places hold it here:
 *
 *   files          the Origin Private File System: the point clouds under
 *                  pointclouds/<projectId>/<cloudId>/, each one entry; an
 *                  import that never finished is one too, without a name;
 *                  anything else at the top of the tree one entry each
 *   entries        localStorage: the settings, the import reports and the
 *                  hidden tracks — small, but each its own entry
 *
 * and IndexedDB a third, as whoever keeps projects there says: the working
 * copies of the variants (server/localStoreSections.js) or the projects of the
 * local build (core/home/localProjects.js), each a section of its own
 * (extension point `localStoreSections`):
 *
 *   { id, read(): Promise<items>, deleteAll(), unsaved?(items): number,
 *     rows(items, ctx): { title, hint?, into?: 'other', rows: [row] } }
 *
 * `ctx` is { t, fill, language, projects, row, size } — `row` makes one line of
 * the dialog. Sizes are what the browser says for files and an estimate for
 * the rest (storedBytes). Nothing here asks the server; the dialog names
 * projects and variants from the list it already has.
 */

const CLOUD_ROOT = 'pointclouds'

/** Bytes as B, kB, MB or GB, in the interface language's numbers. */
export function bytesText(bytes, language) {
  for (const [size, unit] of [[1e9, 'GB'], [1e6, 'MB'], [1e3, 'kB']]) {
    if (bytes >= size) return formatNum(bytes / size, language, { digits: 1, unit })
  }
  return formatNum(Math.round(bytes), language, { unit: 'B' })
}

/** What a localStorage key is: { kind: 'settings' | 'reports' | 'hidden' | 'other', ref }. */
export function classifyKey(key) {
  if (key === SETTINGS_KEY) return { kind: 'settings', ref: null }
  if (key.startsWith(REPORT_KEY_PREFIX)) return { kind: 'reports', ref: key.slice(REPORT_KEY_PREFIX.length) }
  if (key.startsWith(HIDDEN_KEY_PREFIX)) return { kind: 'hidden', ref: key.slice(HIDDEN_KEY_PREFIX.length) }
  return { kind: 'other', ref: null }
}

/** Every file under `dir`: { path (names from the root), bytes, lastModified }. */
export async function walkFiles(dir, path = []) {
  const out = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') {
      out.push(...await walkFiles(handle, [...path, name]))
    } else {
      const file = await handle.getFile()
      out.push({ path: [...path, name], bytes: file.size, lastModified: file.lastModified })
    }
  }
  return out
}

/**
 * The files grouped into what can be deleted as one: a cloud's directory, or
 * a top-level entry outside the clouds. An empty directory holds no file and
 * so does not show — it takes no room either.
 *
 *   clouds  [{ projectId, cloudId, path, bytes, lastModified, hasIndex }]
 *   other   [{ path, bytes, lastModified }]
 */
export function groupFiles(files) {
  const groups = new Map()
  const add = (key, base, file) => {
    const g = groups.get(key) ?? { ...base, bytes: 0, lastModified: 0 }
    g.bytes += file.bytes
    g.lastModified = Math.max(g.lastModified, file.lastModified ?? 0)
    groups.set(key, g)
    return g
  }
  for (const file of files) {
    const [top, projectId, cloudId] = file.path
    if (top === CLOUD_ROOT && file.path.length === 4) {
      const g = add(`c/${projectId}/${cloudId}`, { kind: 'cloud', projectId, cloudId, path: [top, projectId, cloudId], hasIndex: false }, file)
      if (file.path[3] === INDEX_FILE) g.hasIndex = true
    } else if (top === CLOUD_ROOT && file.path.length > 1) {
      // A stray file somewhere in the clouds' tree: that file alone.
      add(`o/${file.path.join('/')}`, { kind: 'other', path: file.path }, file)
    } else {
      add(`o/${top}`, { kind: 'other', path: [top] }, file)
    }
  }
  const all = [...groups.values()].sort((a, b) => b.bytes - a.bytes)
  const strip = ({ kind: _kind, ...g }) => g
  return {
    clouds: all.filter(g => g.kind === 'cloud').map(strip),
    other: all.filter(g => g.kind === 'other').map(strip),
  }
}

async function readIndex(root, path) {
  try {
    let dir = root
    for (const name of path) dir = await dir.getDirectoryHandle(name)
    const file = await (await dir.getFileHandle(INDEX_FILE)).getFile()
    return JSON.parse(await file.text())
  } catch {
    return null
  }
}

async function readFiles() {
  if (!opfsAvailable()) return { clouds: [], other: [] }
  const root = await navigator.storage.getDirectory()
  const { clouds, other } = groupFiles(await walkFiles(root))
  for (const cloud of clouds) {
    const index = cloud.hasIndex ? await readIndex(root, cloud.path) : null
    cloud.name = index?.name ?? null
    cloud.createdAt = index?.createdAt ?? null
  }
  return { clouds, other }
}

/**
 * About the bytes a record takes: its JSON at two bytes a character, as the
 * browser keeps strings, and any Blob in it at its own size.
 */
export function storedBytes(value) {
  let blobs = 0
  try {
    const text = JSON.stringify(value, (_key, v) => {
      if (typeof Blob !== 'undefined' && v instanceof Blob) { blobs += v.size; return null }
      return v
    })
    return 2 * (text?.length ?? 0) + blobs
  } catch {
    return blobs
  }
}

/** What each section of the extension point holds: { [id]: items }, a section that cannot be read empty. */
async function readSections() {
  const all = await Promise.all(extensionsOf('localStoreSections').map(s => s.read().catch(() => [])))
  return Object.fromEntries(extensionsOf('localStoreSections').map((s, k) => [s.id, all[k]]))
}

function readEntries() {
  const out = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key == null) continue
      const value = localStorage.getItem(key) ?? ''
      out.push({ key, ...classifyKey(key), bytes: 2 * (key.length + value.length) })
    }
  } catch { /* no localStorage here */ }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/** Everything the dialog lists, and how much of the browser's room the app takes. */
export async function readLocalStore() {
  const [files, sections, estimate, persisted] = await Promise.all([
    readFiles().catch(() => ({ clouds: [], other: [] })),
    readSections(), storageEstimate(), storagePersisted(),
  ])
  return { ...files, sections, entries: readEntries(), estimate, persisted }
}

async function removePath(path) {
  const root = await navigator.storage.getDirectory()
  let dir = root
  for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name)
  await dir.removeEntry(path.at(-1), { recursive: true })
}

/** Delete a cloud's directory, and its project's directory with it when that is left empty. */
export async function deleteLocalCloud(cloud) {
  await removePath(cloud.path)
  forgetCloud(cloud.cloudId)
  try {
    const project = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(CLOUD_ROOT)).getDirectoryHandle(cloud.projectId)
    for await (const _entry of project.keys()) return
    await removePath([CLOUD_ROOT, cloud.projectId])
  } catch { /* gone already */ }
}

export async function deleteLocalFile(entry) {
  await removePath(entry.path)
  // The cache of the server's clouds (AP 13.6) starts again from nothing.
  if (entry.path[0] === 'cloudcache') forgetCache()
}

export function deleteEntry(key) {
  localStorage.removeItem(key)
  if (classifyKey(key).kind === 'hidden') forgetHiddenTracks()
}

/**
 * Delete all of it: every file, what every section keeps — the working copies
 * with what was not checked in, the projects of the local build — and every
 * entry, settings included, so the app starts as on a new device. Each place
 * is tried even when another fails; the first failure is thrown at the end.
 */
export async function deleteAllLocal() {
  const failures = []
  const attempt = async (fn) => { try { await fn() } catch (err) { failures.push(err) } }
  await attempt(async () => {
    if (!opfsAvailable()) return
    const root = await navigator.storage.getDirectory()
    const names = []
    for await (const name of root.keys()) names.push(name)
    for (const name of names) await root.removeEntry(name, { recursive: true })
  })
  for (const section of extensionsOf('localStoreSections')) await attempt(() => section.deleteAll())
  await attempt(() => { localStorage.clear(); forgetHiddenTracks() })
  forgetAllClouds()
  forgetCache()
  if (failures.length) throw failures[0]
}
