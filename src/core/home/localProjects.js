import { SCHEMA_VERSION, parseProjectsPayload } from '../utils/persistenceUtils'
import { generateId } from '../utils/identifierUtils'
import { closeStoredProject, currentStoredMeta, openStoredProject } from '../storage'
import { storedBytes } from '../localStore'
import { formatDate } from '../locales/i18n'

/**
 * The projects of the local build (Paket L, decision 279): a list in this
 * browser's IndexedDB — create, open, rename, delete — and files to export
 * and import. No variants, no revisions: the browser holds the only copy.
 *
 * DB `olt-local`, version 1, two stores keyed by the project's id:
 *   projects   { id, project (dehydrated), idLog, createdAt, updatedAt }
 *   summaries  { id, title, description, image, tracks, switches, platforms,
 *                createdAt, updatedAt } — what the list shows, without
 *                reading every project whole
 * Both are written in one transaction. The project's title, description and
 * picture (a data URL, `image`, as the files carry it) live in the record
 * itself, so an exported file is a complete one.
 */

const DB_NAME = 'olt-local'
const DB_VERSION = 1
const PROJECTS = 'projects'
const SUMMARIES = 'summaries'

let _db = null

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
}

function openDb() {
  _db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { _db = null; reject(request.error) }
  })
  return _db
}

/** What the list shows of a stored project. */
export function summaryOf({ id, project, createdAt, updatedAt }) {
  return {
    id, title: project.title ?? '', description: project.description ?? '', image: project.image ?? null,
    tracks: project.tracks?.length ?? 0, switches: project.switches?.length ?? 0, platforms: project.platforms?.length ?? 0,
    createdAt, updatedAt,
  }
}

async function put(record) {
  const db = await openDb()
  const tx = db.transaction([PROJECTS, SUMMARIES], 'readwrite')
  tx.objectStore(PROJECTS).put(record)
  tx.objectStore(SUMMARIES).put(summaryOf(record))
  await txDone(tx)
}

async function get(id) {
  const db = await openDb()
  const tx = db.transaction(PROJECTS, 'readonly')
  const record = await req(tx.objectStore(PROJECTS).get(id))
  await txDone(tx)
  return record ?? null
}

/** Every project of this browser, the last changed first. */
export async function listLocalProjects() {
  const db = await openDb()
  const tx = db.transaction(SUMMARIES, 'readonly')
  const all = await req(tx.objectStore(SUMMARIES).getAll())
  await txDone(tx)
  return all.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** A new, empty project; resolves its id. */
export async function createLocalProject({ title, description = '', image = null }) {
  const id = generateId()
  const now = new Date().toISOString()
  const project = { id, title, ...(description ? { description } : {}), ...(image ? { image } : {}), tracks: [], switches: [], platforms: [] }
  await put({ id, project, idLog: [], createdAt: now, updatedAt: now })
  return id
}

/**
 * The projects of a file (`{ version, projects }`, as exported here or from a
 * server variant) as projects of their own — each a new id, so a file read
 * in twice is two projects. Throws the PayloadError of parseProjectsPayload.
 * Resolves how many came in.
 */
export async function importLocalProjects(data, fallbackTitle = '') {
  const { projects } = parseProjectsPayload(data)
  const now = new Date().toISOString()
  for (const p of projects) {
    const id = generateId()
    const { imageHash: _hash, ...record } = p
    await put({ id, project: { ...record, id, title: p.title || fallbackTitle }, idLog: [], createdAt: now, updatedAt: now })
  }
  return projects.length
}

/** The file of one project: `{ version, projects: [record] }`, its picture embedded. */
export async function exportLocalProject(id) {
  const record = await get(id)
  if (!record) return null
  return { version: SCHEMA_VERSION, projects: [record.project] }
}

/** Change a project's title, description or picture (`image` a data URL, null to take it away). */
export async function updateLocalProject(id, { title, description, image }) {
  const record = await get(id)
  if (!record) return
  const project = { ...record.project }
  if (title !== undefined) project.title = title
  if (description !== undefined) project.description = description
  if (image !== undefined) {
    if (image) project.image = image
    else delete project.image
  }
  await put({ ...record, project, updatedAt: new Date().toISOString() })
}

/** Forget a project — its record, and its point clouds read in on this device. */
export async function deleteLocalProject(id) {
  if (currentStoredMeta()?.localId === id) await closeStoredProject()
  const db = await openDb()
  const tx = db.transaction([PROJECTS, SUMMARIES], 'readwrite')
  tx.objectStore(PROJECTS).delete(id)
  tx.objectStore(SUMMARIES).delete(id)
  await txDone(tx)
  try {
    const clouds = await (await navigator.storage.getDirectory()).getDirectoryHandle('pointclouds')
    await clouds.removeEntry(id, { recursive: true })
  } catch { /* none read in */ }
}

/** Make a stored project the open one, written back on every change. Resolves it hydrated. */
export async function openLocalProject(id) {
  const record = await get(id)
  if (!record) throw new Error(`no project ${id}`)
  const { createdAt } = record
  return openStoredProject({
    project: record.project, idLog: record.idLog ?? [], key: id, meta: { localId: id },
    save: ({ project, idLog, updatedAt }) => put({ id, project, idLog, createdAt, updatedAt }),
  })
}

/** The projects as a section of the local storage dialog (core/localStore.js). */
export const localProjectsSection = {
  id: 'localProjects',
  async read() {
    const db = await openDb()
    const tx = db.transaction(PROJECTS, 'readonly')
    const all = await req(tx.objectStore(PROJECTS).getAll())
    await txDone(tx)
    return all.map(r => ({ id: r.id, title: r.project.title ?? '', updatedAt: r.updatedAt, bytes: storedBytes(r) }))
      .sort((a, b) => b.bytes - a.bytes)
  },
  async deleteAll() {
    for (const p of await listLocalProjects()) await deleteLocalProject(p.id)
  },
  rows: (items, { t, fill, language, row }) => ({
    title: t('local_projects_store'),
    hint: t('local_projects_store_hint'),
    rows: items.map(p => row({
      key: `project/${p.id}`,
      title: p.title || t('local_store_unknown_project'),
      meta: [formatDate(p.updatedAt, language, { time: true })],
      bytes: p.bytes, estimated: true,
      ask: fill('local_projects_delete_ask', { title: p.title }),
      onDelete: () => deleteLocalProject(p.id),
    })),
  }),
}
