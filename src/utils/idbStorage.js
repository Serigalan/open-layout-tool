// Thin promise wrapper around IndexedDB for the project store.
//
// DB `olt`, two object stores:
//   projects – keyPath `id`, one record per (dehydrated) project
//   images   – key = projectId, value = data-URL string
//
// storage.js keeps the synchronous in-memory cache and calls these from its
// write-behind flush; nothing here is imported by UI code.

const DB_NAME = 'olt'
const DB_VERSION = 1

let _dbPromise = null

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror   = () => reject(request.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
}

export function openDb() {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('images'))   db.createObjectStore('images')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror   = () => reject(request.error)
  })
  return _dbPromise
}

/** Read the full store: { projects: [...], images: [{ id, image }] } */
export async function readAll() {
  const db = await openDb()
  const tx = db.transaction(['projects', 'images'], 'readonly')
  const projects  = await req(tx.objectStore('projects').getAll())
  const imgStore  = tx.objectStore('images')
  const imgKeys   = await req(imgStore.getAllKeys())
  const imgValues = await req(imgStore.getAll())
  await txDone(tx)
  return { projects, images: imgKeys.map((id, i) => ({ id, image: imgValues[i] })) }
}

/**
 * Apply one atomic batch to the `projects` store.
 *   puts    – project records to write (put by id)
 *   deletes – project ids to remove
 *   keepIds – when given, additionally remove every record whose id is not in
 *             the set (used to re-sync after undo/import)
 */
export async function writeProjects({ puts = [], deletes = [], keepIds = null }) {
  const db = await openDb()
  const tx = db.transaction('projects', 'readwrite')
  const store = tx.objectStore('projects')
  for (const p of puts) store.put(p)
  for (const id of deletes) store.delete(id)
  if (keepIds) {
    const existing = await req(store.getAllKeys())
    for (const id of existing) if (!keepIds.has(id)) store.delete(id)
  }
  await txDone(tx)
}

/** Write (dataUrl string) or remove (null) one project image. */
export async function writeImage(projectId, dataUrl) {
  const db = await openDb()
  const tx = db.transaction('images', 'readwrite')
  if (dataUrl) tx.objectStore('images').put(dataUrl, projectId)
  else         tx.objectStore('images').delete(projectId)
  await txDone(tx)
}
