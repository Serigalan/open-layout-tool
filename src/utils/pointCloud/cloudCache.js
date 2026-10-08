/**
 * What was fetched of the clouds on the server, kept in this browser (AP 13.6):
 * a cross section walked back and forth, a trace run twice, or the next day's
 * work at the same place reads from here instead of the network.
 *
 *     cloudcache/index.json   which segments lie where, and when each pack was last used
 *     cloudcache/<pack>.bin   the segments of one answer of the server, back to back
 *
 * A pack is written once and never changed; the cache forgets whole packs,
 * the least recently used first, once it holds more than its limit (2 GB
 * unless set otherwise). The tiles on the server never change, so nothing in
 * here goes stale — a cloud deleted on the server leaves packs that age out.
 *
 * Without OPFS, or without writable files on the main thread, the cache stays
 * empty and every read goes to the server.
 */

const DIR = 'cloudcache'
const INDEX = 'index.json'
const LIMIT_KEY = 'olt.cloudCacheBytes'
const DEFAULT_CACHE_BYTES = 2 * 1024 ** 3
/** The index is saved this long after the last change [ms]. */
const SAVE_AFTER = 1500

let state = null        // Promise<{ dir, packs: Map, entries: Map }> | null
let saveTimer = null

const usable = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  && typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype

/** The cache's limit [bytes]. */
export function cacheLimit() {
  try {
    const v = Number(localStorage.getItem(LIMIT_KEY))
    return v > 0 ? v : DEFAULT_CACHE_BYTES
  } catch {
    return DEFAULT_CACHE_BYTES
  }
}

export function setCacheLimit(bytes) {
  try { localStorage.setItem(LIMIT_KEY, String(Math.max(0, Math.round(bytes)))) } catch { /* kept at the default */ }
  load().then(evict).catch(() => {})
}

/** The cache as it stands, loaded once. A pack the index does not know is a leftover and goes. */
function load() {
  if (!usable()) return Promise.reject(new Error('no cache'))
  state ??= (async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(DIR, { create: true })
    const packs = new Map(), entries = new Map()
    try {
      const saved = JSON.parse(await (await (await dir.getFileHandle(INDEX)).getFile()).text())
      for (const p of saved.packs ?? []) packs.set(p.name, { name: p.name, bytes: p.bytes, used: p.used, keys: [] })
      for (const [key, pack, at, length] of saved.entries ?? []) {
        const p = packs.get(pack)
        if (!p) continue
        entries.set(key, { pack, at, length })
        p.keys.push(key)
      }
    } catch { /* a new cache */ }
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || name === INDEX || packs.has(name.replace(/\.bin$/, ''))) continue
      const file = await handle.getFile().catch(() => null)
      if (file && Date.now() - file.lastModified > 10 * 60 * 1000) await dir.removeEntry(name).catch(() => {})
    }
    return { dir, packs, entries }
  })()
  return state
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const { dir, packs, entries } = await load()
      const body = JSON.stringify({
        packs: [...packs.values()].map(({ name, bytes, used }) => ({ name, bytes, used })),
        entries: [...entries].map(([key, e]) => [key, e.pack, e.at, e.length]),
      })
      const w = await (await dir.getFileHandle(INDEX, { create: true })).createWritable()
      await w.write(body)
      await w.close()
    } catch { /* the next change saves it */ }
  }, SAVE_AFTER)
}

async function evict(st) {
  const limit = cacheLimit()
  let total = [...st.packs.values()].reduce((n, p) => n + p.bytes, 0)
  if (total <= limit) return
  const byAge = [...st.packs.values()].sort((a, b) => a.used - b.used)
  for (const p of byAge) {
    if (total <= limit) break
    st.packs.delete(p.name)
    for (const key of p.keys) st.entries.delete(key)
    total -= p.bytes
    await st.dir.removeEntry(`${p.name}.bin`).catch(() => {})
  }
  scheduleSave()
}

/**
 * The cached bytes of `keys` — a Map key → Uint8Array of those there are.
 * Never throws: a cache that cannot be read has nothing.
 */
export async function cacheGet(keys) {
  const out = new Map()
  let st
  try { st = await load() } catch { return out }
  const byPack = new Map()
  for (const key of keys) {
    const e = st.entries.get(key)
    if (!e) continue
    if (!byPack.has(e.pack)) byPack.set(e.pack, [])
    byPack.get(e.pack).push([key, e])
  }
  const now = Date.now()
  await Promise.all([...byPack].map(async ([pack, list]) => {
    try {
      const file = await (await st.dir.getFileHandle(`${pack}.bin`)).getFile()
      const lo = Math.min(...list.map(([, e]) => e.at)), hi = Math.max(...list.map(([, e]) => e.at + e.length))
      const bytes = new Uint8Array(await file.slice(lo, hi).arrayBuffer())
      for (const [key, e] of list) out.set(key, bytes.slice(e.at - lo, e.at - lo + e.length))
      const p = st.packs.get(pack)
      if (p) p.used = now
    } catch {
      // A pack gone missing (another tab evicted it): forget what pointed there.
      const p = st.packs.get(pack)
      if (p) { for (const k of p.keys) st.entries.delete(k); st.packs.delete(pack) }
    }
  }))
  if (byPack.size) scheduleSave()
  return out
}

/** Keep `items` — `[[key, Uint8Array], …]`, one answer of the server — as a pack. Best effort. */
export async function cachePut(items) {
  if (!items.length) return
  let st
  try { st = await load() } catch { return }
  const fresh = items.filter(([key]) => !st.entries.has(key))
  if (!fresh.length) return
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const total = fresh.reduce((n, [, b]) => n + b.length, 0)
  const all = new Uint8Array(total)
  const keys = []
  let at = 0
  try {
    for (const [key, bytes] of fresh) {
      all.set(bytes, at)
      keys.push([key, at, bytes.length])
      at += bytes.length
    }
    const w = await (await st.dir.getFileHandle(`${name}.bin`, { create: true })).createWritable()
    await w.write(all)
    await w.close()
  } catch {
    return
  }
  st.packs.set(name, { name, bytes: total, used: Date.now(), keys: keys.map(k => k[0]) })
  for (const [key, a, length] of keys) st.entries.set(key, { pack: name, at: a, length })
  await evict(st)
  scheduleSave()
}

/** Bytes the cache holds now (0 where there is none). */
export async function cacheUsage() {
  try {
    const st = await load()
    return [...st.packs.values()].reduce((n, p) => n + p.bytes, 0)
  } catch {
    return 0
  }
}

/** Empty the cache. */
export async function clearCache() {
  try {
    const st = await load()
    for (const p of st.packs.values()) await st.dir.removeEntry(`${p.name}.bin`).catch(() => {})
    st.packs.clear()
    st.entries.clear()
    scheduleSave()
  } catch { /* nothing to clear */ }
}

/** Forget the loaded state — after the whole OPFS was cleared elsewhere. */
export function forgetCache() {
  state = null
}
