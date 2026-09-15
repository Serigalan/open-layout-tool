import {
  SCHEMA_VERSION, extractImages, hydrateProjects, dehydrateProjects,
} from './utils/persistenceUtils'
import { reverseElement } from './utils/elementUtils'
import { reverseHeights, splitHeights, trackLength } from './utils/heightUtils'
import * as idb from './utils/idbStorage'

export const STORAGE_KEY = 'olt_projects'
const SETTINGS_KEY = 'olt_settings'
const IMAGE_KEY_PREFIX = 'olt_image_'

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } catch { return {} }
}

export function saveSettings(patch) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }))
}

export function generateId() {
  return crypto.randomUUID()
}

// In-memory cache – single source of truth for all synchronous callers.
// Persistence is IndexedDB via an async write-behind flush (see persist/flush);
// localStorage remains only as legacy source (one-time takeover) and as
// fallback backend when IndexedDB is unavailable.
let _cache = null
let _images = new Map()      // projectId → data-URL string
let _backend = 'idb'         // 'idb' | 'ls'
const MAX_UNDO = 20
let _undoStack = []

// Write-behind state (idb backend)
let _dirty = new Set()       // project ids to (re)write
let _deleted = new Set()     // project ids to remove
let _syncAll = false         // also remove idb records missing from the cache (undo)
let _flushTimer = null
let _flushChain = Promise.resolve()

// Read the localStorage store ({ version, projects }) plus the per-project
// image keys — only used by the localStorage fallback backend.
function readLocalStorageStore() {
  let raw = null
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    raw = null
  }
  const projects = Array.isArray(raw?.projects) ? raw.projects : []
  const images = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(IMAGE_KEY_PREFIX)) {
      images.push({ id: key.slice(IMAGE_KEY_PREFIX.length), image: localStorage.getItem(key) })
    }
  }
  return { projects, images }
}

function adoptStore({ projects, images }) {
  _cache = hydrateProjects(projects)
  _images = new Map(images.map(({ id, image }) => [id, image]))
}

/**
 * Load the store into memory — await this once before rendering the app.
 * Source of truth is IndexedDB; if it is unavailable, fall back to the
 * localStorage backend entirely.
 */
export async function initStorage() {
  if (_cache !== null) return
  try {
    await idb.openDb()
    adoptStore(await idb.readAll())
    registerLifecycleFlush()
  } catch (err) {
    console.error('IndexedDB unavailable – falling back to localStorage persistence', err)
    _backend = 'ls'
    adoptStore(readLocalStorageStore())
  }
}

function getCache() {
  if (_cache !== null) return _cache
  // initStorage() was not awaited (unexpected) — degrade to the synchronous
  // localStorage backend so callers keep working.
  _backend = 'ls'
  adoptStore(readLocalStorageStore())
  return _cache
}

function pushUndo() {
  _undoStack.push(JSON.stringify(getCache()))
  if (_undoStack.length > MAX_UNDO) _undoStack.shift()
}

// Mark a project dirty (or, without id, everything incl. deletion re-sync) and
// schedule the async flush. The localStorage backend writes synchronously.
function persist(projectId = null) {
  if (_backend === 'ls') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, projects: dehydrateProjects(_cache) }))
    return
  }
  if (projectId) {
    _dirty.add(projectId)
  } else {
    _syncAll = true
    getCache().forEach(p => _dirty.add(p.id))
  }
  scheduleFlush()
}

function scheduleFlush() {
  if (_backend !== 'idb' || _flushTimer) return
  _flushTimer = setTimeout(() => flushPendingWrites(), 0)
}

/** Start writing all pending changes to IndexedDB; resolves when done. */
export function flushPendingWrites() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  if (_backend !== 'idb' || (_dirty.size === 0 && _deleted.size === 0 && !_syncAll)) return _flushChain
  const byId    = new Map(getCache().map(p => [p.id, p]))
  const dirty   = [..._dirty].filter(id => byId.has(id));  _dirty.clear()
  const deleted = [..._deleted].filter(id => !byId.has(id)); _deleted.clear()
  const syncAll = _syncAll; _syncAll = false
  const puts    = dehydrateProjects(dirty.map(id => byId.get(id)))
  const keepIds = syncAll ? new Set(byId.keys()) : null
  _flushChain = _flushChain
    .then(() => idb.writeProjects({ puts, deletes: deleted, keepIds }))
    .catch(err => {
      console.error('Persisting to IndexedDB failed – retrying on next change', err)
      dirty.forEach(id => _dirty.add(id))
      deleted.forEach(id => _deleted.add(id))
      if (syncAll) _syncAll = true
    })
  return _flushChain
}

let _lifecycleRegistered = false
function registerLifecycleFlush() {
  if (_lifecycleRegistered || typeof window === 'undefined') return
  _lifecycleRegistered = true
  window.addEventListener('pagehide', () => { flushPendingWrites() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingWrites()
  })
}

export function canUndo() {
  return _undoStack.length > 0
}

export function undo() {
  if (_undoStack.length === 0) return false
  _cache = JSON.parse(_undoStack.pop())
  persist()
  return true
}

export function loadProjects() {
  return getCache()
}

export function saveProject(project) {
  getCache().push(project)
  persist(project.id)
}

/** Merge fields into a project record (used for the OSRD infra passthrough). */
export function updateProject(projectId, patch) {
  pushUndo()
  const project = getCache().find(p => p.id === projectId)
  if (!project) return
  Object.assign(project, patch)
  persist(projectId)
}

// Project images live outside the project records so they are not
// re-serialized on every track mutation and do not ride through the undo
// snapshots. In-memory map for synchronous reads, persisted per project.
export function loadProjectImage(projectId) {
  getCache()
  return _images.get(projectId) ?? null
}

export function saveProjectImage(projectId, dataUrl) {
  getCache()
  if (dataUrl) _images.set(projectId, dataUrl)
  else _images.delete(projectId)
  if (_backend === 'idb') {
    idb.writeImage(projectId, dataUrl ?? null).catch(err => console.error('Persisting image failed', err))
  } else if (dataUrl) {
    localStorage.setItem(IMAGE_KEY_PREFIX + projectId, dataUrl)
  } else {
    localStorage.removeItem(IMAGE_KEY_PREFIX + projectId)
  }
}

/**
 * Merge projects into the store (same id replaces). Embedded images are moved
 * to their own store and derived geometry is rebuilt.
 */
export function importProjects(projects) {
  pushUndo()
  extractImages(projects).forEach(({ id, image }) => saveProjectImage(id, image))
  hydrateProjects(projects)
  const existing = getCache()
  const importedIds = new Set(projects.map(p => p.id))
  _cache = [...existing.filter(p => !importedIds.has(p.id)), ...projects]
  projects.forEach(p => persist(p.id))
}

/** Self-contained export payload (images embedded); ids: Set to filter, or null for all. */
export function exportProjectsPayload(ids = null) {
  const projects = getCache().filter(p => !ids || ids.has(p.id))
  return {
    version: SCHEMA_VERSION,
    projects: dehydrateProjects(projects).map(p => {
      const image = loadProjectImage(p.id)
      return image ? { ...p, image } : p
    }),
  }
}

export function deleteProject(id) {
  pushUndo()
  _cache = getCache().filter((p) => p.id !== id)
  saveProjectImage(id, null)
  if (_backend === 'idb') {
    _deleted.add(id)
    _dirty.delete(id)
    scheduleFlush()
  } else {
    persist()
  }
}

export function loadTracks(projectId) {
  return getCache().find((p) => p.id === projectId)?.tracks ?? []
}

/** Switches that reference `trackId` on any of their three ports. */
export function switchesOnTrack(projectId, trackId) {
  return loadSwitches(projectId).filter(sw => PORT_IDS.some(k => sw[k] === trackId))
}

/**
 * Delete a track. A switch that references it loses its reason to exist and goes
 * with it — together with the branch track carrying that switch's own geometry
 * (a track whose elements are all switchBranch). The ordinary tracks on the
 * switch's other ports stay; only the switch itself disappears. A platform is
 * stationed along its track and cannot outlive it either.
 */
export function deleteTrack(projectId, trackId) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  const tracks   = project.tracks ?? []
  const switches = project.switches ?? []

  const isBranchTrack = (id) => {
    const tr = tracks.find(t => t.id === id)
    const els = tr?.elements ?? []
    return els.length > 0 && els.every(el => el.switchBranch)
  }

  const doomed  = new Set(switches.filter(sw => PORT_IDS.some(k => sw[k] === trackId)))
  const removed = new Set([trackId])
  doomed.forEach(sw => PORT_IDS.forEach(k => { if (sw[k] && isBranchTrack(sw[k])) removed.add(sw[k]) }))

  project.tracks   = tracks.filter(t => !removed.has(t.id))
  project.switches = switches.filter(sw => !doomed.has(sw))
  if (project.platforms?.length) {
    project.platforms = project.platforms.filter(p => !removed.has(p.trackId))
  }
  persist(projectId)
}

export function saveTrack(projectId, track) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.tracks = [...(project.tracks ?? []), track]
  persist(projectId)
}

export function updateTrack(projectId, track) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.tracks = (project.tracks ?? []).map((t) => t.id === track.id ? track : t)
  persist(projectId)
}


// A switch port names a track plus which end of it the switch sits at. The end
// is the track's own BEGIN (elements[0].startNode) or END (last endNode) — the
// axis that OSRD's track_section arrow and all length offsets refer to.
const PORT_IDS  = ['portA_trackId',   'portB1_trackId',   'portB2_trackId']
const PORT_ENDS = ['portA_endpoint',  'portB1_endpoint',  'portB2_endpoint']

const flipEndpoint = (e) => (e === 'BEGIN' ? 'END' : e === 'END' ? 'BEGIN' : e)

function remapSwitches(switches, remap) {
  // remap: [{ oldId, newId, flip }]
  //   newId array [firstHalf, secondHalf] – a track was split; the port's
  //     endpoint decides which half it stays on,
  //   flip – the track was folded into the new one backwards, so BEGIN/END swap.
  return (switches ?? []).map(sw => {
    const updated = { ...sw }
    PORT_IDS.forEach((idKey, i) => {
      const entry = remap.find(r => r.oldId === sw[idKey])
      if (!entry) return
      if (Array.isArray(entry.newId)) {
        updated[idKey] = sw[PORT_ENDS[i]] === 'BEGIN' ? entry.newId[0] : entry.newId[1]
      } else {
        updated[idKey] = entry.newId
        if (entry.flip) updated[PORT_ENDS[i]] = flipEndpoint(sw[PORT_ENDS[i]])
      }
    })
    return updated
  })
}

/** Flip BEGIN/END on every switch port that references `trackId`. */
function flipSwitchEndpoints(switches, trackId) {
  return (switches ?? []).map(sw => {
    if (!PORT_IDS.some(k => sw[k] === trackId)) return sw
    const updated = { ...sw }
    PORT_IDS.forEach((idKey, i) => {
      if (sw[idKey] === trackId) updated[PORT_ENDS[i]] = flipEndpoint(sw[PORT_ENDS[i]])
    })
    return updated
  })
}

export function remapSwitchTrackIds(projectId, remap) {
  pushUndo()
  const project = getCache().find(p => p.id === projectId)
  if (!project) return
  project.switches = remapSwitches(project.switches, remap)
  persist(projectId)
}

export function rebuildCoords(elements) {
  return elements.reduce((coords, el, i) => {
    const c = el.renderCoords ?? el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...coords, ...c.slice(1)]
  }, [])
}

export function recalcAbsLengths(elements) {
  let running = 0
  return elements.map((el) => {
    running += el.length
    return { ...el, absLength: running }
  })
}

export function nextTrackName(prefix, existingNames) {
  const set = new Set(existingNames)
  for (let i = 1; i <= 999; i++) {
    const candidate = `${prefix}.${String(i).padStart(3, '0')}`
    if (!set.has(candidate)) return candidate
  }
  return `${prefix}.${Date.now()}`
}

function makeTrack(base, elements, id, heights) {
  const elems = recalcAbsLengths(elements)
  const { elements: _e, coordinates: _c, id: _id, heights: _h, ...rest } = base
  return {
    ...rest,
    id:          id ?? generateId(),
    coordinates: rebuildCoords(elems),
    elements:    elems,
    ...(heights?.length ? { heights } : {}),
  }
}

export function deleteElement(projectId, trackId, elementIndex) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  const track = (project.tracks ?? []).find((t) => t.id === trackId)
  if (!track || !track.elements) return

  const idx    = Number(elementIndex)
  const before = track.elements.slice(0, idx)
  const after  = track.elements.slice(idx + 1)

  const beforeId = crypto.randomUUID()
  const afterId  = crypto.randomUUID()

  // The vertical alignment is stationed along the track: the stretch over the
  // deleted element goes with it, the tail restarts at 0.
  const cutAt   = before.reduce((sum, el) => sum + (el.length ?? 0), 0)
  const [headH] = splitHeights(track.heights, cutAt)
  const [, tailH] = splitHeights(track.heights, cutAt + (track.elements[idx]?.length ?? 0))

  const newTracks = []
  if (before.length > 0) newTracks.push(makeTrack(track, before, beforeId, headH))
  if (after.length > 0)  newTracks.push(makeTrack(track, after,  afterId, tailH))

  project.tracks   = (project.tracks ?? []).filter((t) => t.id !== trackId).concat(newTracks)
  project.switches = remapSwitches(project.switches ?? [], [{
    oldId: trackId,
    newId: [beforeId, afterId],
  }])
  persist(projectId)
}

export function addElementToTrack(projectId, trackId, element) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  const track = (project.tracks ?? []).find((t) => t.id === trackId)
  if (!track) return
  const elements = track.elements ?? []
  const prevAbsLength = elements.length > 0 ? (elements[elements.length - 1].absLength ?? elements[elements.length - 1].length) : 0
  const elementWithAbs = { ...element, absLength: prevAbsLength + element.length }
  track.elements = [...elements, elementWithAbs]
  const coords = elementWithAbs.geometry?.coordinates
  if (coords && coords.length > 0) {
    track.coordinates = [...(track.coordinates ?? []), ...coords.slice(1)]
  }
  persist(projectId)
}

/**
 * Reverse a track's direction. The element order and every element flip, so the
 * track's BEGIN/END swap — switch ports referencing it are flipped with it, all
 * under a single undo step. Length offsets (absLength, and the OSRD `curves`
 * derived from it) follow automatically from the new element order; the height
 * points are stationed along the track, so they mirror about its length.
 */
export function reverseTrackDirection(projectId, trackId) {
  pushUndo()
  const project = getCache().find(p => p.id === projectId)
  if (!project) return
  const track = (project.tracks ?? []).find(t => t.id === trackId)
  if (!track) return
  const elements = recalcAbsLengths([...(track.elements ?? [])].reverse().map(reverseElement))
  const heights  = reverseHeights(track.heights, trackLength(track))
  project.tracks = project.tracks.map(t => t.id === trackId
    ? { ...t, elements, coordinates: rebuildCoords(elements), ...(heights ? { heights } : {}) }
    : t)
  project.switches = flipSwitchEndpoints(project.switches, trackId)
  persist(projectId)
}

/**
 * Write a track's vertical alignment — its height points along the track. The
 * automatic terrain fill passes undo: false, an automatic step must not
 * swallow the user's Ctrl+Z.
 */
export function setTrackHeights(projectId, trackId, heights, opts = {}) {
  return setHeightsForTracks(projectId, new Map([[trackId, heights]]), opts)
}

/**
 * The same for several tracks at once (`byTrack`: trackId → heights), as one
 * undo step — the height where tracks meet belongs to all of them.
 */
export function setHeightsForTracks(projectId, byTrack, { undo = true } = {}) {
  if (undo) pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return false
  let written = false
  for (const [trackId, heights] of byTrack) {
    const track = project.tracks?.find((t) => t.id === trackId)
    if (!track) continue
    if (heights?.length) track.heights = heights; else delete track.heights
    written = true
  }
  if (written) persist(projectId)
  return written
}

export function replaceAllTracks(projectId, tracks) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.tracks = tracks
  persist(projectId)
}

export function loadPlatforms(projectId) {
  return getCache().find((p) => p.id === projectId)?.platforms ?? []
}

export function savePlatform(projectId, platform) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.platforms = [...(project.platforms ?? []), platform]
  persist(projectId)
}

export function updatePlatform(projectId, platform) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.platforms = (project.platforms ?? []).map((p) => p.id === platform.id ? platform : p)
  persist(projectId)
}

export function deletePlatform(projectId, platformId) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.platforms = (project.platforms ?? []).filter((p) => p.id !== platformId)
  persist(projectId)
}

/**
 * The kilometrage lines the project references its main points against — one
 * per line number, each the stretch around the project with a kilometrage on
 * every vertex (see kmLineSource for where they come from).
 *
 * They are reference data, not something the user drew, so they stay off the
 * undo stack: undoing a track edit must not take a fetched line with it, and
 * fetching one must not eat an undo step.
 */
export function loadKmLines(projectId) {
  return getCache().find((p) => p.id === projectId)?.kmLines ?? []
}

/** Add or replace the line with this number. */
export function saveKmLine(projectId, kmLine) {
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  const same = (l) => String(l.lineNumber) === String(kmLine.lineNumber)
  project.kmLines = [...(project.kmLines ?? []).filter((l) => !same(l)), kmLine]
  persist(projectId)
}

/** Drop a line number — what a line no track names any more. */
export function deleteKmLine(projectId, lineNumber) {
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.kmLines = (project.kmLines ?? [])
    .filter((l) => String(l.lineNumber) !== String(lineNumber))
  persist(projectId)
}

export function loadSwitches(projectId) {
  return getCache().find((p) => p.id === projectId)?.switches ?? []
}

export function saveSwitch(projectId, sw) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  project.switches = [...(project.switches ?? []), sw]
  persist(projectId)
}

/**
 * Atomically replace the two selected line tracks of a switch connection with the
 * resulting tracks (four split halves + the connection) and add the two junction
 * switches — all under a single undo step. Pre-existing switches that referenced
 * an original line track are repointed via `remap` (a split repoints at the
 * second half; switches carry no per-port geometry to distinguish them).
 *
 * @param {string}   projectId
 * @param {object}   ops
 * @param {string[]} ops.removeTrackIds  ids of the two original line tracks
 * @param {object[]} ops.addTracks       new track objects (with ids)
 * @param {object[]} ops.addSwitches     new switch records
 * @param {object[]} ops.remap           remapSwitches entries for existing switches
 */
export function commitSwitchConnection(projectId, { removeTrackIds, addTracks, addSwitches, remap }) {
  pushUndo()
  const project = getCache().find((p) => p.id === projectId)
  if (!project) return
  const removeSet = new Set(removeTrackIds)
  project.tracks = (project.tracks ?? []).filter((t) => !removeSet.has(t.id)).concat(addTracks ?? [])
  if (remap?.length) project.switches = remapSwitches(project.switches ?? [], remap)
  project.switches = [...(project.switches ?? []), ...(addSwitches ?? [])]
  persist(projectId)
}

export function readImageAsBase64(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null)
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}
