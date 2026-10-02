import { SCHEMA_VERSION, hydrateProjects, dehydrateProjects } from './utils/persistenceUtils'
import { elementBelongsToSwitch, unmarkSwitchElement } from './utils/switchModel'
import { rebuildSwitchSymbol } from './utils/switchUtils'
import { splitHeights } from './utils/heightUtils'
import { flipSwitchEndpoints, makeTrack, portTracks, referencesTrack, remapSwitches, reverseTrack } from './utils/trackModel'
import { generateId } from './utils/identifierUtils'
import { remapEndMarks, flipEndMarks, pruneEndMarks, endKey } from './utils/trackEndMarks'
import * as idb from './utils/idbStorage'

const REPORT_KEY_PREFIX = 'olt_reports_'

// The project store: the one project that is open — the working copy of a
// variant (phase 10) — held in memory as the single source of truth for every
// synchronous caller, and written behind to IndexedDB (see persist/flush).
// Where IndexedDB is unavailable the copy lives in memory only.
//
// The record is immutable (R1.3): every write makes a new project object, new
// arrays for what it changes and shares everything else. That is what makes a
// snapshot for undo a reference, and what lets React subscribe to it.
let _project = null
let _backend = 'idb'         // 'idb' | 'memory'
let _opened = false
// The open working copy: { variantId, projectId, base, basePayload } — the
// revision it rests on (meta) and that revision's record.
let _wc = null
const MAX_UNDO = 20
let _undoStack = []
let _undoDepth = 0
// The id log (decision 93): what splitting and joining made of which track ids
// since the working copy's base — [{ from, to: [ids] }]. A merge reads it to
// carry the other side's references onto the new tracks.
let _idLog = []

// Write-behind state (idb backend)
let _dirty = false
let _flushTimer = null
let _flushChain = Promise.resolve()

// In development and in the tests the record is frozen as it is written, so a
// caller that changes a track in place — which would change every undo
// snapshot sharing it — fails at once instead of corrupting history quietly.
const FREEZE = import.meta.env?.DEV || import.meta.env?.MODE === 'test'
function deepFreeze(value) {
  if (!FREEZE || value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

/**
 * Open the store — await this once before rendering the app. Nothing is read
 * here: a working copy is loaded when its variant is opened.
 */
export async function initStorage() {
  if (_opened) return
  _opened = true
  try {
    await idb.openDb()
    registerLifecycleFlush()
  } catch (err) {
    console.error('IndexedDB unavailable – the working copy is kept in memory only', err)
    _backend = 'memory'
  }
}

function backend() {
  if (!_opened) { _opened = true; _backend = 'memory' }
  return _backend
}

/** The open project (the working copy's record, hydrated), or null. */
export function currentProject() {
  return _project
}

/**
 * Apply one change to the open project: `fn` gets the project and returns the
 * new one (or the same to change nothing). A step for undo unless `undo` is
 * false; nothing at all — not even an undo step — when no project is open.
 * Returns whether a project was there to change.
 */
function mutate(fn, { undo = true } = {}) {
  if (!_project) return false
  const before = _project, logBefore = _idLog
  const next = fn(_project)
  if (!next || next === before) { _idLog = logBefore; return true }
  if (undo) pushUndo(before, logBefore)
  setProject(withPrunedMarks(next))
  return true
}

function setProject(project) {
  _project = deepFreeze(project)
  persist()
  notify()
}

// ── subscribers (R1.4) ──────────────────────────────────────────────────────

const _listeners = new Set()

/**
 * Be told after every change of the open project or of the undo stack — a
 * write, an undo, a project opened or closed. Returns the unsubscribe. What
 * React's useSyncExternalStore takes (see hooks/useStore.js).
 */
export function subscribe(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function notify() {
  for (const listener of [..._listeners]) listener()
}

// ── the working copy (phase 10) ─────────────────────────────────────────────

/**
 * Make a variant's working copy the open project: `project` its record
 * (dehydrated), `base` the revision it rests on and `basePayload` that
 * revision's record, `idLog` the splits and joins since. Undo starts empty.
 */
export function openWorkingCopy({ variantId, project, base, basePayload, idLog = [] }) {
  backend()
  _wc = { variantId, projectId: project.id, base, basePayload }
  _idLog = [...idLog]
  _undoStack = []
  setProject(withPrunedMarks(hydrateProjects([structuredClone(project)])[0]))
  return _project
}

/**
 * Open a project that is no variant's working copy — kept in memory only, with
 * an empty undo stack. What the tests and a throwaway preview use.
 */
export function openProject(project) {
  backend()
  _wc = null
  _idLog = []
  _undoStack = []
  setProject(withPrunedMarks(project))
  return _project
}

/** The open working copy: { variantId, projectId, base, basePayload, project (dehydrated), idLog }, or null. */
export function currentWorkingCopy() {
  if (!_wc || !_project) return null
  return { ..._wc, project: dehydrateProjects([structuredClone(_project)])[0], idLog: loadIdLog() }
}

/**
 * Put a merged record in place of the working copy, resting on `base` now.
 * Undo is emptied: a step back must not take back the other side's changes.
 */
export function adoptWorkingCopy({ project, base, basePayload, idLog }) {
  if (!_wc) return null
  const log = idLog ?? loadIdLog()
  return openWorkingCopy({ variantId: _wc.variantId, project, base, basePayload, idLog: log })
}

/** The working copy was checked in as `base`: it rests on it now, and its id log is spent. */
export function markCheckedIn({ base, basePayload }) {
  if (!_wc) return
  _wc = { ..._wc, base, basePayload }
  setIdLog([])
  persist()
}

/** Close the open working copy (it stays in IndexedDB). */
export async function closeWorkingCopy() {
  await flushPendingWrites()
  _project = null
  _wc = null
  _idLog = []
  _undoStack = []
  notify()
}

/** A variant's stored working copy, or null. */
export async function loadWorkingCopy(variantId) {
  if (backend() !== 'idb') return null
  try { return await idb.getWorkingCopy(variantId) } catch { return null }
}

/** Every stored working copy (for the start page's status). */
export async function listWorkingCopies() {
  if (backend() !== 'idb') return []
  try { return await idb.getAllWorkingCopies() } catch { return [] }
}

/** Throw a variant's working copy away. */
export async function discardWorkingCopy(variantId) {
  if (_wc?.variantId === variantId) await closeWorkingCopy()
  if (backend() === 'idb') await idb.deleteWorkingCopy(variantId)
}

/** Empty the undo stack. */
export function clearUndo() {
  _undoStack = []
  notify()
}

/**
 * Keep the state before a change for undo. The record is immutable (R1.3), so
 * a snapshot is the reference itself — no copy, whatever the project's size.
 * The plan header is not restored by an undo (see savePlanHeader); undo puts
 * the current one onto whatever it brings back.
 */
function pushUndo(project = _project, idLog = _idLog) {
  if (_undoDepth > 0 || !project) return
  _undoStack.push({ project, idLog })
  if (_undoStack.length > MAX_UNDO) _undoStack.shift()
}

/** The id log of the open project: [{ from, to: [ids] }], oldest first. */
export function loadIdLog() {
  return _idLog
}

/** Replace the id log — empty once its changes are checked in. */
export function setIdLog(log) {
  _idLog = [...(log ?? [])]
}

/**
 * Append the id changes of one remap (the entries remapSwitches takes) to the
 * log. Only ids that changed and pieces the project now has are logged: a
 * rename onto itself (a flip) is no id change, and a split that left no piece
 * on one side names a track that never came to be.
 */
function logRemap(project, remap) {
  if (!project || !remap?.length) return
  const present = new Set((project.tracks ?? []).map(t => t.id))
  const entries = []
  for (const { oldId, newId } of remap) {
    const to = (Array.isArray(newId) ? newId : [newId]).filter(id => id && present.has(id))
    if (!oldId || !to.length || (to.length === 1 && to[0] === oldId)) continue
    entries.push({ from: oldId, to })
  }
  if (entries.length) _idLog = [..._idLog, ...entries]
}

/**
 * Run several storage mutations as one undo step: the snapshot is taken once,
 * before the first mutation, and the mutations' own pushUndo calls pass while
 * the batch runs. A form that commits a switch piece by piece (appended leg,
 * branch tracks, the record) becomes one Ctrl+Z, the way the commitSwitch*
 * functions already are.
 */
export function withUndo(fn) {
  const before = _project, logBefore = _idLog
  _undoDepth++
  try {
    return fn()
  } finally {
    _undoDepth--
    if (_undoDepth === 0 && _project !== before) pushUndo(before, logBefore)
  }
}

// A track end mark lives only as long as its end is free (trackEndMarks): any
// write that takes the track away or connects a switch to that end drops it.
// Done here rather than in each writer, because every writer comes by here.
function withPrunedMarks(project) {
  if (!project?.endMarks?.length) return project
  const kept = pruneEndMarks(project.endMarks, project.tracks, project.switches)
  return kept === project.endMarks ? project : { ...project, endMarks: kept }
}

// Mark the working copy dirty and schedule the async flush. A project that is
// not the open working copy (openProject) lives in memory only.
function persist() {
  if (backend() !== 'idb' || !_wc) return
  _dirty = true
  scheduleFlush()
}

function scheduleFlush() {
  if (_backend !== 'idb' || _flushTimer) return
  _flushTimer = setTimeout(() => flushPendingWrites(), 0)
}

/** Start writing the working copy to IndexedDB; resolves when done. */
export function flushPendingWrites() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
  if (_backend !== 'idb' || !_dirty || !_wc) return _flushChain
  _dirty = false
  const wc = currentWorkingCopy()
  if (!wc) return _flushChain
  const record = { ...wc, updatedAt: new Date().toISOString() }
  _flushChain = _flushChain
    .then(() => idb.putWorkingCopy(record))
    .catch(err => {
      console.error('Persisting to IndexedDB failed – retrying on next change', err)
      _dirty = true
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
  // The header is not part of the snapshot, so it is kept as it is now.
  const header = _project?.planHeader
  const { project, idLog } = _undoStack.pop()
  _idLog = idLog
  setProject(project.planHeader === header ? project : { ...project, planHeader: header })
  return true
}

/** Merge fields into the project record (used for the OSRD infra passthrough). */
export function updateProject(patch) {
  return mutate(p => ({ ...p, ...patch }))
}

/**
 * What an import had to say, kept so it can be read again — per variant
 * where a working copy is open (the variants of a project share its id).
 *
 * An import of a whole database writes thousands of lines — what it could not
 * place, what it had to infer from the alignment because the file does not
 * state it, where the file disagrees with itself — and until now they were gone
 * with the next click. They are kept per project, newest first, and outside the
 * project record: a report is about an import, not about the alignment, so it
 * has no business riding through every undo snapshot or into the exchange file.
 *
 * localStorage is the right place for exactly that reason, and it is also a
 * small one: a report is cut to REPORT_LINES and only REPORTS_KEPT of them are
 * held. A store too full to take one must not make the import fail, so a
 * refused write falls back to keeping the newest report alone.
 */
const REPORTS_KEPT = 8
const REPORT_LINES = 4000

// Per variant where a working copy is open (the variants of a project share
// its id), else per project.
const reportKey = () => REPORT_KEY_PREFIX + (_wc?.variantId ?? _project?.id ?? 'none')

export function loadImportReports() {
  try {
    const raw = JSON.parse(localStorage.getItem(reportKey()) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

export function saveImportReport(report) {
  const entry = {
    ...report,
    at: report.at ?? Date.now(),
    lines: (report.lines ?? []).slice(0, REPORT_LINES),
    cut: Math.max(0, (report.lines ?? []).length - REPORT_LINES),
  }
  const all = [entry, ...loadImportReports()].slice(0, REPORTS_KEPT)
  const write = (list) => localStorage.setItem(reportKey(), JSON.stringify(list))
  try {
    write(all)
    return all
  } catch {
    try {
      write([{ ...entry, lines: entry.lines.slice(0, 200), cut: entry.lines.length - 200 }])
    } catch { /* nothing to be done; the import itself stands */ }
    return loadImportReports()
  }
}

export function clearImportReports() {
  try { localStorage.removeItem(reportKey()) } catch { /* already gone */ }
}

/**
 * The open project as a file ({ version, projects }), dehydrated. Its image
 * goes by the hash the server keeps it under (`imageHash`).
 */
export function exportProjectsPayload() {
  const projects = _project ? [structuredClone(_project)] : []
  return { version: SCHEMA_VERSION, projects: dehydrateProjects(projects) }
}

// ── plan header ─────────────────────────────────────────────────────────────

/**
 * The title block of a plan — parties with logo and address, who drew and
 * checked it — as the project's metadata, `project.planHeader`. It is part of
 * the variant's record and versioned with it (decision 101).
 */
export function loadPlanHeader() {
  return _project?.planHeader ?? null
}

/**
 * Store the header on the project. Not an undo step: it is what the plans
 * are signed with, not the alignment, and its logos would ride through every
 * snapshot (see pushUndo). False when there is no project.
 */
export function savePlanHeader(header) {
  return mutate(p => ({ ...p, planHeader: header }), { undo: false })
}

// ── tracks ──────────────────────────────────────────────────────────────────

export function loadTracks() {
  return _project?.tracks ?? []
}

/** Switches that reference `trackId` on any of their three ports. */
export function switchesOnTrack(trackId) {
  return loadSwitches().filter(sw => referencesTrack(sw, trackId))
}

/** The project without `trackId` — see deleteTrack. */
function withoutTrack(project, trackId) {
  const tracks   = project.tracks ?? []
  const switches = project.switches ?? []

  // A track that is nothing but this switch's own geometry. Asking whose
  // geometry it is — and not merely whether it is some switch's — keeps a track
  // two turnouts share, as a crossover's connection is, out of one of them.
  const isBranchTrack = (id, sw) => {
    const tr = tracks.find(t => t.id === id)
    const els = tr?.elements ?? []
    return els.length > 0 && els.every(el => el.switchBranch && elementBelongsToSwitch(el, sw))
  }

  const doomed  = new Set(switches.filter(sw => referencesTrack(sw, trackId)))
  const removed = new Set([trackId])
  doomed.forEach(sw => portTracks(sw).forEach(id => { if (isBranchTrack(id, sw)) removed.add(id) }))

  // The tracks that stay keep their geometry, but no longer a switch's marks:
  // an element naming a switch that is gone would point at nothing.
  const goneIds = new Set([...doomed].map(sw => sw.switchId).filter(Boolean))
  return {
    ...project,
    tracks: tracks.filter(t => !removed.has(t.id)).map(t => (
      (t.elements ?? []).some(el => el.switchId && goneIds.has(el.switchId))
        ? { ...t, elements: t.elements.map(el => (el.switchId && goneIds.has(el.switchId) ? unmarkSwitchElement(el) : el)) }
        : t)),
    switches: switches.filter(sw => !doomed.has(sw)),
    ...(project.platforms?.length ? { platforms: project.platforms.filter(p => !removed.has(p.trackId)) } : {}),
  }
}

/**
 * Delete a track. A switch that references it loses its reason to exist and goes
 * with it — together with the branch track carrying that switch's own geometry
 * (a track whose elements are all switchBranch). The ordinary tracks on the
 * switch's other ports stay, their elements without that switch's marks; only
 * the switch itself disappears. A platform is stationed along its track and
 * cannot outlive it either.
 */
export function deleteTrack(trackId) {
  return mutate(p => withoutTrack(p, trackId))
}

/**
 * Delete several tracks at once — a whole network from the topology diagram —
 * as one undo step, each the way deleteTrack takes one: its switches and
 * their own branch tracks with it.
 */
export function deleteTracks(trackIds) {
  return mutate(p => trackIds.reduce(withoutTrack, p))
}

export function saveTrack(track) {
  return mutate(p => ({ ...p, tracks: [...(p.tracks ?? []), track] }))
}

export function updateTrack(track) {
  return mutate(p => ({ ...p, tracks: (p.tracks ?? []).map(t => (t.id === track.id ? track : t)) }))
}

/**
 * Repoint switch ports and end marks after tracks were renamed, split or
 * joined. `consumed` names the ends that stopped being ends in the change — a
 * splice joins two — whose marks have to go rather than follow the remap.
 */
export function remapSwitchTrackIds(remap, { consumed = [] } = {}) {
  return mutate(p => {
    const next = {
      ...p,
      switches: remapSwitches(p.switches, remap),
      endMarks: remapEndMarks(p.endMarks, remap, consumed),
    }
    logRemap(next, remap)
    return next
  })
}

export function deleteElement(trackId, elementIndex) {
  return mutate(p => {
    const track = (p.tracks ?? []).find(t => t.id === trackId)
    if (!track?.elements) return p

    const idx    = Number(elementIndex)
    const before = track.elements.slice(0, idx)
    const after  = track.elements.slice(idx + 1)

    const beforeId = generateId()
    const afterId  = generateId()

    // The vertical alignment is stationed along the track: the stretch over the
    // deleted element goes with it, the tail restarts at 0.
    const cutAt   = before.reduce((sum, el) => sum + (el.length ?? 0), 0)
    const [headH] = splitHeights(track.heights, cutAt)
    const [, tailH] = splitHeights(track.heights, cutAt + (track.elements[idx]?.length ?? 0))

    const newTracks = []
    if (before.length > 0) newTracks.push(makeTrack(track, before, beforeId, headH))
    if (after.length > 0)  newTracks.push(makeTrack(track, after,  afterId, tailH))

    const remap = [{ oldId: trackId, newId: [beforeId, afterId] }]
    const next = {
      ...p,
      tracks:   (p.tracks ?? []).filter(t => t.id !== trackId).concat(newTracks),
      switches: remapSwitches(p.switches ?? [], remap),
      endMarks: remapEndMarks(p.endMarks, remap),
    }
    logRemap(next, remap)
    return next
  })
}

export function addElementToTrack(trackId, element) {
  return mutate(p => {
    const track = (p.tracks ?? []).find(t => t.id === trackId)
    if (!track) return p
    const elements = track.elements ?? []
    const last = elements[elements.length - 1]
    const prevAbsLength = last ? (last.absLength ?? last.length) : 0
    const elementWithAbs = { ...element, absLength: prevAbsLength + element.length }
    // The same polyline rebuildCoords and the reload take, which is the coarse one
    // wherever the element carries it: appending the fine one instead left the
    // track drawn at one density until a reload replaced it with the other.
    const coords = elementWithAbs.renderCoords ?? elementWithAbs.geometry?.coordinates
    const updated = {
      ...track,
      elements: [...elements, elementWithAbs],
      ...(coords?.length ? { coordinates: [...(track.coordinates ?? []), ...coords.slice(1)] } : {}),
    }
    return { ...p, tracks: p.tracks.map(t => (t.id === trackId ? updated : t)) }
  })
}

/**
 * Reverse a track's direction. The element order and every element flip, so the
 * track's BEGIN/END swap — switch ports referencing it are flipped with it, all
 * under a single undo step. Length offsets (absLength, and the OSRD `curves`
 * derived from it) follow automatically from the new element order; the height
 * points are stationed along the track, so they mirror about its length.
 */
export function reverseTrackDirection(trackId) {
  return mutate(p => {
    const track = (p.tracks ?? []).find(t => t.id === trackId)
    if (!track) return p
    const reversed = reverseTrack(track)
    return {
      ...p,
      tracks:   p.tracks.map(t => (t.id === trackId ? reversed : t)),
      switches: flipSwitchEndpoints(p.switches, trackId),
      endMarks: flipEndMarks(p.endMarks, trackId),
    }
  })
}

/**
 * Write a track's vertical alignment — its height points along the track. The
 * automatic terrain fill passes undo: false, an automatic step must not
 * swallow the user's Ctrl+Z.
 */
export function setTrackHeights(trackId, heights, opts = {}) {
  return setHeightsForTracks(new Map([[trackId, heights]]), opts)
}

/**
 * The same for several tracks at once (`byTrack`: trackId → heights), as one
 * undo step — the height where tracks meet belongs to all of them. False
 * when none of the tracks is there.
 */
export function setHeightsForTracks(byTrack, { undo = true } = {}) {
  let written = false
  mutate(p => {
    const tracks = (p.tracks ?? []).map(t => {
      if (!byTrack.has(t.id)) return t
      written = true
      const heights = byTrack.get(t.id)
      if (heights?.length) return { ...t, heights }
      const { heights: _h, ...rest } = t
      return rest
    })
    return written ? { ...p, tracks } : p
  }, { undo })
  return written
}

export function replaceAllTracks(tracks) {
  return mutate(p => ({ ...p, tracks }))
}

/**
 * Write back an edited track set and rebuild the symbols of the switches the
 * edit reached (AP 5.1) — in one undo step, because they are one change.
 *
 * A switch symbol is derived from the tracks its routes lie on
 * (rebuildSwitchSymbol), and until now only a reload rebuilt it. An edit that
 * re-shaped a turnout's own elements therefore left the symbol standing on the
 * geometry it used to have, which is precisely the case the editor's reach
 * limit exists for: what still gets through has to be drawn as it now is.
 */
export function commitTrackEdit(tracks, switchIds = []) {
  return mutate(p => {
    const rebuild = new Set(switchIds)
    let switches = p.switches
    if (rebuild.size && switches?.length) {
      const byId = Object.fromEntries(tracks.map(t => [t.id, t]))
      switches = switches.map(sw => (rebuild.has(sw.switchId) ? rebuildSwitchSymbol(sw, byId) : sw))
    }
    return { ...p, tracks, ...(switches ? { switches } : {}) }
  })
}

// ── platforms ───────────────────────────────────────────────────────────────

export function loadPlatforms() {
  return _project?.platforms ?? []
}

export function savePlatform(platform) {
  return mutate(p => ({ ...p, platforms: [...(p.platforms ?? []), platform] }))
}

export function updatePlatform(platform) {
  return mutate(p => ({ ...p, platforms: (p.platforms ?? []).map(q => (q.id === platform.id ? platform : q)) }))
}

export function deletePlatform(platformId) {
  return mutate(p => ({ ...p, platforms: (p.platforms ?? []).filter(q => q.id !== platformId) }))
}

// ── kilometrage lines ───────────────────────────────────────────────────────

/**
 * The kilometrage lines the project references its main points against — one
 * per line number, each the stretch around the project with a kilometrage on
 * every vertex (see kmLineSource for where they come from).
 *
 * They are reference data, not something the user drew, so they stay off the
 * undo stack: undoing a track edit must not take a fetched line with it, and
 * fetching one must not eat an undo step.
 */
export function loadKmLines() {
  return _project?.kmLines ?? []
}

/** Add or replace the line with this number. */
export function saveKmLine(kmLine) {
  const same = (l) => String(l.lineNumber) === String(kmLine.lineNumber)
  return mutate(p => ({ ...p, kmLines: [...(p.kmLines ?? []).filter(l => !same(l)), kmLine] }), { undo: false })
}

/** Drop a line number — what a line no track names any more. */
export function deleteKmLine(lineNumber) {
  return mutate(p => ({
    ...p, kmLines: (p.kmLines ?? []).filter(l => String(l.lineNumber) !== String(lineNumber)),
  }), { undo: false })
}

// ── end marks ───────────────────────────────────────────────────────────────

/** The marks on free track ends — buffer stops and boundaries (trackEndMarks). */
export function loadEndMarks() {
  return _project?.endMarks ?? []
}

/** Put a mark on its end, replacing whatever mark stood there. One undo step. */
export function saveEndMark(mark) {
  const key = endKey(mark.trackId, mark.endpoint)
  return mutate(p => ({
    ...p,
    endMarks: [
      ...(p.endMarks ?? []).filter(m => m.id !== mark.id && endKey(m.trackId, m.endpoint) !== key),
      mark,
    ],
  }))
}

export function deleteEndMark(markId) {
  return mutate(p => ({ ...p, endMarks: (p.endMarks ?? []).filter(m => m.id !== markId) }))
}

// ── switches ────────────────────────────────────────────────────────────────

export function loadSwitches() {
  return _project?.switches ?? []
}

export function saveSwitch(sw) {
  return mutate(p => ({ ...p, switches: [...(p.switches ?? []), sw] }))
}

/** Merge fields into one switch record, as one undo step. */
export function updateSwitch(switchId, patch) {
  return mutate(p => ({
    ...p, switches: (p.switches ?? []).map(sw => (sw.switchId === switchId ? { ...sw, ...patch } : sw)),
  }))
}

/**
 * Atomically replace the two selected line tracks of a switch connection with the
 * resulting tracks (four split halves + the connection) and add the two junction
 * switches — all under a single undo step. Pre-existing switches that referenced
 * an original line track are repointed via `remap` (a split repoints at the
 * second half; switches carry no per-port geometry to distinguish them).
 *
 * @param {object}   ops
 * @param {string[]} ops.removeTrackIds  ids of the two original line tracks
 * @param {object[]} ops.addTracks       new track objects (with ids)
 * @param {object[]} ops.addSwitches     new switch records
 * @param {object[]} ops.remap           remapSwitches entries for existing switches
 * @param {object[]} [ops.addEndMarks]   buffer stops / boundaries on the new tracks' ends
 */
export function commitSwitchConnection({ removeTrackIds, addTracks, addSwitches, remap, addEndMarks }) {
  return mutate(p => {
    const removeSet = new Set(removeTrackIds)
    let next = {
      ...p,
      tracks: (p.tracks ?? []).filter(t => !removeSet.has(t.id)).concat(addTracks ?? []),
    }
    if (remap?.length) {
      next = { ...next, switches: remapSwitches(next.switches ?? [], remap), endMarks: remapEndMarks(next.endMarks, remap) }
      logRemap(next, remap)
    }
    next = { ...next, switches: [...(next.switches ?? []), ...(addSwitches ?? [])] }
    if (addEndMarks?.length) next = { ...next, endMarks: [...(next.endMarks ?? []), ...addEndMarks] }
    return next
  })
}

/**
 * Carry out a switch deletion (switchDelete.planSwitchDeletion): the record
 * goes, the tracks that were nothing but its geometry go with it, the tracks it
 * rewrote take their new elements, and every other switch that named a track
 * the join has swallowed is repointed — all under a single undo step, the way
 * commitSwitchConnection commits one.
 *
 * A platform is stationed along its track and cannot outlive it, exactly as in
 * deleteTrack.
 *
 * @param {object}   plan
 * @param {string}   plan.switchId       the record to remove
 * @param {string[]} plan.removeTrackIds tracks that go entirely
 * @param {object[]} plan.updateTracks   tracks to replace in place (same ids)
 * @param {object[]} plan.remap          remapSwitches entries for the others
 */
export function commitSwitchDeletion({ switchId, removeTrackIds, updateTracks, remap }) {
  return mutate(p => {
    const removeSet = new Set(removeTrackIds ?? [])
    const updated   = new Map((updateTracks ?? []).map(t => [t.id, t]))
    // The record first, then the remap: the switch that is going has no ports
    // left to repoint, and leaving it in would point them at the joined track.
    let next = {
      ...p,
      tracks: (p.tracks ?? []).filter(t => !removeSet.has(t.id)).map(t => updated.get(t.id) ?? t),
      switches: (p.switches ?? []).filter(sw => sw.switchId !== switchId),
    }
    if (remap?.length) {
      next = { ...next, switches: remapSwitches(next.switches, remap), endMarks: remapEndMarks(next.endMarks, remap) }
      logRemap(next, remap)
    }
    if (next.platforms?.length) next = { ...next, platforms: next.platforms.filter(q => !removeSet.has(q.trackId)) }
    return next
  })
}
