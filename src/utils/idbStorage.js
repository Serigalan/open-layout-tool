// Thin promise wrapper around IndexedDB for the working copies (phase 10).
//
// DB `olt`, version 2, one object store in use:
//   workingCopies – keyPath `variantId`, one record per variant a user has
//                   opened: { variantId, projectId, base, basePayload,
//                   project, idLog, updatedAt } — the record being edited
//                   (dehydrated), the revision it rests on and that
//                   revision's record, for merging against.
//
// The stores of version 1 (`projects`, `images`) are left as they are and no
// longer read: there is no taking over of local projects (decision 95). The
// local storage dialog shows what they still hold and empties them on request.
//
// storage.js keeps the synchronous in-memory copy and calls these from its
// write-behind flush, localStore.js for that dialog; nothing here is imported
// by UI code.

const DB_NAME = 'olt'
const DB_VERSION = 2
const WORKING = 'workingCopies'

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
      if (!db.objectStoreNames.contains(WORKING)) db.createObjectStore(WORKING, { keyPath: 'variantId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror   = () => reject(request.error)
  })
  return _dbPromise
}

/** One working copy, or null. */
export async function getWorkingCopy(variantId) {
  const db = await openDb()
  const tx = db.transaction(WORKING, 'readonly')
  const record = await req(tx.objectStore(WORKING).get(variantId))
  await txDone(tx)
  return record ?? null
}

/** Every working copy. */
export async function getAllWorkingCopies() {
  const db = await openDb()
  const tx = db.transaction(WORKING, 'readonly')
  const records = await req(tx.objectStore(WORKING).getAll())
  await txDone(tx)
  return records
}

export async function putWorkingCopy(record) {
  const db = await openDb()
  const tx = db.transaction(WORKING, 'readwrite')
  tx.objectStore(WORKING).put(record)
  await txDone(tx)
}

export async function deleteWorkingCopy(variantId) {
  const db = await openDb()
  const tx = db.transaction(WORKING, 'readwrite')
  tx.objectStore(WORKING).delete(variantId)
  await txDone(tx)
}

/** The stores this version no longer reads (see above), those that are there. */
const legacyStores = (db) => [...db.objectStoreNames].filter(name => name !== WORKING)

/**
 * What the stores of version 1 still hold: { records, bytes }.
 */
export async function legacyContents() {
  const db = await openDb()
  const names = legacyStores(db)
  if (!names.length) return { records: 0, bytes: 0 }
  const tx = db.transaction(names, 'readonly')
  const all = (await Promise.all(names.map(name => req(tx.objectStore(name).getAll())))).flat()
  await txDone(tx)
  return { records: all.length, bytes: all.reduce((sum, r) => sum + storedBytes(r), 0) }
}

export async function clearLegacyStores() {
  const db = await openDb()
  const names = legacyStores(db)
  if (!names.length) return
  const tx = db.transaction(names, 'readwrite')
  for (const name of names) tx.objectStore(name).clear()
  await txDone(tx)
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
