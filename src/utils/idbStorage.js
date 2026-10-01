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
// longer read: there is no taking over of local projects (decision 95), and
// leaving them costs nothing that deleting them could give back.
//
// storage.js keeps the synchronous in-memory copy and calls these from its
// write-behind flush; nothing here is imported by UI code.

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
