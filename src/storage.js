import { SCHEMA_VERSION, hydrateProjects, dehydrateProjects } from './utils/persistenceUtils'
import { elementBelongsToSwitch, portsOf, unmarkSwitchElement } from './utils/switchModel'
import { rebuildSwitchSymbol } from './utils/switch/symbol'
import { sliceHeights } from './utils/heightUtils'
import { flipSwitchEndpoints, makeTrack, nextTrackName, portTracks, referencesTrack, remapSwitches, reverseTrack } from './utils/trackModel'
import { generateId } from './utils/identifierUtils'
import { remapEndMarks, flipEndMarks, pruneEndMarks, endKey } from './utils/trackEndMarks'
import * as idb from './utils/idbStorage'
import { coupleSwitchGradients, touchedTurnouts } from './utils/switchGradient'
import { repairRoutes } from './utils/routes'

export const REPORT_KEY_PREFIX = 'olt_reports_'

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
// What undo took back, newest last, for redo (R10.1); any new step empties it.
let _redoStack = []
// The last step taken, undone or redone (R10.3): { serial, kind: 'do' | 'undo'
// | 'redo', before, after } — what the step notice says and highlights.
let _lastStep = null
let _stepSerial = 0
const recordStep = (kind, before, after) => { _lastStep = { serial: ++_stepSerial, kind, before, after } }

/** The last step taken, undone or redone, or null since the project was opened. */
export const lastStep = () => _lastStep
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
  if (undo) { pushUndo(before, logBefore); _redoStack = [] }
  // A route over a track the write took away runs over what lies there now (decision 249).
  const after = withCoupledGradients(before, withPrunedMarks(repairRoutes(before, next)))
  if (undo && _undoDepth === 0) recordStep('do', before, after)
  setProject(after)
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
  _redoStack = []
  _lastStep = null
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
  _redoStack = []
  _lastStep = null
  setProject(withPrunedMarks(project))
  return _project
}

/** The variant whose working copy is open, or null — cheaper than currentWorkingCopy where only that is wanted. */
export const currentVariantId = () => _wc?.variantId ?? null

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
  _redoStack = []
  _lastStep = null
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
  _redoStack = []
  _lastStep = null
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
function setIdLog(log) {
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
    if (_undoDepth === 0 && _project !== before) {
      pushUndo(before, logBefore)
      _redoStack = []
      recordStep('do', before, _project)
      notify()
    }
  }
}

// A track end mark lives only as long as its end is free (trackEndMarks): any
// write that takes the track away or connects a switch to that end drops it.
// Done here rather than in each writer, because every writer comes by here.
/**
 * The project with the branch of every turnout a write reached coupled to its
 * main route again (switchGradient): the main route leads, so a height, a cant
 * or a geometry changed there moves the branch along, and a height changed on
 * the branch between WA and ldS goes back to the plane — in the same step, so
 * one undo takes back both. Turnouts the write did not reach are left alone,
 * coupled or not.
 */
function withCoupledGradients(before, project) {
  const only = touchedTurnouts(before, project)
  return only.size ? coupleSwitchGradients(project, { only }) : project
}

/**
 * Apply what fitting a crossover worked out (crossoverGradient): the new
 * heights of the tracks it reached and the new cant of their curve, as one
 * undo step — the coupling of the turnouts follows in the same step.
 */
export function applyCrossoverGradient(plan) {
  if (!plan?.ok) return false
  return mutate(p => ({
    ...p,
    tracks: (p.tracks ?? []).map(t => {
      const heights = plan.heights.get(t.id)
      const elements = plan.elements.get(t.id)
      if (!heights && !elements) return t
      return { ...t, ...(heights ? { heights } : {}), ...(elements ? { elements } : {}) }
    }),
  }))
}

/**
 * Couple the branch of every turnout to its main route, as one undo step —
 * for a project whose turnouts were never written since coupling began, and
 * which the store couples only where a write reaches them.
 */
export function coupleAllSwitchGradients() {
  return mutate(p => coupleSwitchGradients(p))
}

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

// Writing behind dehydrates the whole project, so a burst of writes is
// written once, when it has come to rest. Leaving the page flushes at once
// (registerLifecycleFlush), as does closing the working copy.
const FLUSH_DELAY = 300   // ms
const FLUSH_MAX_WAIT = 2000   // …but a burst that never rests is written this often
let _flushPendingSince = 0

function scheduleFlush() {
  if (_backend !== 'idb') return
  const now = Date.now()
  if (_flushTimer) clearTimeout(_flushTimer)
  else _flushPendingSince = now
  const wait = now - _flushPendingSince >= FLUSH_MAX_WAIT ? 0 : FLUSH_DELAY
  _flushTimer = setTimeout(() => flushPendingWrites(), wait)
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
  const before = _project
  _redoStack.push({ project: _project, idLog: _idLog })
  const entry = _undoStack.pop()
  recordStep('undo', before, entry.project)
  restore(entry)
  return true
}

export function canRedo() {
  return _redoStack.length > 0
}

/** Take the last undo back again (R10.1). */
export function redo() {
  if (_redoStack.length === 0) return false
  const before = _project
  _undoStack.push({ project: _project, idLog: _idLog })
  const entry = _redoStack.pop()
  recordStep('redo', before, entry.project)
  restore(entry)
  return true
}

/**
 * The step an undo would take back and the one a redo would bring again, as
 * { before, after } — the two project states, for describing them (stepLabel).
 * Null where there is none. The same objects while nothing changes, so a
 * subscriber can hold on to them.
 */
export function undoStep() {
  const top = _undoStack[_undoStack.length - 1]
  if (!top) return null
  if (_undoStepCache?.top !== top || _undoStepCache.after !== _project) _undoStepCache = { top, after: _project, step: { before: top.project, after: _project } }
  return _undoStepCache.step
}
export function redoStep() {
  const top = _redoStack[_redoStack.length - 1]
  if (!top) return null
  if (_redoStepCache?.top !== top || _redoStepCache.before !== _project) _redoStepCache = { top, before: _project, step: { before: _project, after: top.project } }
  return _redoStepCache.step
}
let _undoStepCache = null
let _redoStepCache = null

// A snapshot back into place. The header is not part of the snapshots, so it
// is kept as it is now.
function restore({ project, idLog }) {
  const header = _project?.planHeader
  _idLog = idLog
  setProject(project.planHeader === header ? project : { ...project, planHeader: header })
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

// ── tracks hidden on the map ────────────────────────────────────────────────

/**
 * The tracks hidden from the map (Bearbeiten → Gleise ein-/ausblenden): a way
 * of looking at the project, not part of it — kept on this device per project
 * like the import reports, outside the record, so it rides through no undo
 * step, no check-in and no exchange file. The variants of a project share it,
 * as they share their track ids. An id whose track is gone is never asked
 * about again; a track is shown unless it is named here.
 *
 * The set is the same object until it changes, as useSyncExternalStore wants.
 */
export const HIDDEN_KEY_PREFIX = 'olt_hidden_tracks_'
const hiddenKey = () => HIDDEN_KEY_PREFIX + (_project?.id ?? 'none')
let _hidden = { key: null, ids: new Set() }

/** Read the hidden tracks afresh next time — their entry was deleted from outside. */
export function forgetHiddenTracks() {
  _hidden = { key: null, ids: new Set() }
}

export function hiddenTracks() {
  const key = hiddenKey()
  if (_hidden.key !== key) {
    let ids = []
    try { ids = JSON.parse(localStorage.getItem(key) ?? '[]') } catch { /* none kept, or no storage */ }
    _hidden = { key, ids: new Set(Array.isArray(ids) ? ids : []) }
  }
  return _hidden.ids
}

/** Hide (`hidden` true) or show the tracks `trackIds` on the map. */
export function setTracksHidden(trackIds, hidden) {
  const next = new Set(hiddenTracks())
  for (const id of trackIds) {
    if (hidden) next.add(id)
    else next.delete(id)
  }
  const key = hiddenKey()
  _hidden = { key, ids: next }
  try {
    if (next.size) localStorage.setItem(key, JSON.stringify([...next]))
    else localStorage.removeItem(key)
  } catch { /* kept for this session only */ }
  notify()
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
  const doomed = (project.switches ?? []).filter(sw => referencesTrack(sw, trackId))
  const next = withoutSwitches(project, doomed, [trackId])
  return {
    ...next,
    tracks: next.tracks.filter(t => t.id !== trackId),
    ...(next.platforms?.length ? { platforms: next.platforms.filter(p => p.trackId !== trackId) } : {}),
  }
}

/**
 * The project without the switches `doomed`, and without the tracks that were
 * nothing but one of their own geometry — a track whose elements all belong
 * to that switch's branch. Asking whose geometry it is — and not merely
 * whether it is some switch's — keeps a track two turnouts share, as a
 * crossover's connection is, out of one of them. `alsoGone` are tracks the
 * caller removes anyway. The tracks that stay keep their geometry, but no
 * longer a gone switch's marks: an element naming a switch that is gone would
 * point at nothing.
 */
function withoutSwitches(project, doomed, alsoGone = []) {
  if (!doomed.length) return project
  const tracks = project.tracks ?? []
  const isBranchTrack = (id, sw) => {
    const tr = tracks.find(t => t.id === id)
    const els = tr?.elements ?? []
    return els.length > 0 && els.every(el => el.switchBranch && elementBelongsToSwitch(el, sw))
  }
  const removed = new Set(alsoGone)
  const branchGone = new Set()
  doomed.forEach(sw => portTracks(sw).forEach(id => { if (isBranchTrack(id, sw)) { removed.add(id); branchGone.add(id) } }))
  const goneIds = new Set(doomed.map(sw => sw.switchId).filter(Boolean))
  const doomedSet = new Set(doomed)
  return {
    ...project,
    tracks: tracks.filter(t => !branchGone.has(t.id)).map(t => (
      (t.elements ?? []).some(el => el.switchId && goneIds.has(el.switchId))
        ? { ...t, elements: t.elements.map(el => (el.switchId && goneIds.has(el.switchId) ? unmarkSwitchElement(el) : el)) }
        : t)),
    switches: (project.switches ?? []).filter(sw => !doomedSet.has(sw)),
    ...(project.platforms?.length ? { platforms: project.platforms.filter(p => !branchGone.has(p.trackId)) } : {}),
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
  return deleteElements([{ trackId, elementIndex: Number(elementIndex) }])
}

/**
 * Delete elements — any number, on any tracks — as one undo step. What is
 * left of a track falls apart into its runs of elements still next to each
 * other, each a track of its own: the first keeps the track's name, the
 * others take the next free one. A track with nothing left goes the way
 * deleteTrack takes one.
 *
 * The vertical alignment is the track's, stationed along it: each run keeps
 * its stretch of it, and where the gradient runs over a cut it gets a height
 * point there at the height the gradient has (sliceHeights).
 *
 * A switch standing at an end that is deleted has lost that end and goes with
 * its own branch, as with deleteTrack; the others stay on the run that holds
 * their end. End marks on a deleted end go, the others follow their end.
 * A platform stays where its run holds it whole, re-stationed, and goes where
 * the cut runs through it.
 *
 * `picks` is [{ trackId, elementIndex }].
 */
export function deleteElements(picks) {
  return mutate(p => withoutElements(p, picks))
}

function withoutElements(project, picks) {
  const byTrack = new Map()
  for (const { trackId, elementIndex } of picks ?? []) {
    if (!byTrack.has(trackId)) byTrack.set(trackId, new Set())
    byTrack.get(trackId).add(Number(elementIndex))
  }
  const names = new Set((project.tracks ?? []).map(t => t.name).filter(Boolean))
  const replaced = new Map()   // old track id → its runs
  const remap = [], logged = [], deadEnds = [], emptied = []
  let platforms = project.platforms
  for (const [trackId, gone] of byTrack) {
    const track = (project.tracks ?? []).find(t => t.id === trackId)
    const els = track?.elements ?? []
    if (!els.some((_, i) => gone.has(i))) continue
    if (els.every((_, i) => gone.has(i))) { emptied.push(trackId); continue }

    // The runs of elements left, with the stretch of the track each covers.
    const runs = []
    let station = 0
    els.forEach((el, i) => {
      const len = el.length ?? 0
      if (!gone.has(i)) {
        const last = runs[runs.length - 1]
        if (last && last.to === i - 1) { last.to = i; last.s1 = station + len }
        else runs.push({ from: i, to: i, s0: station, s1: station + len })
      }
      station += len
    })
    const prefix = (track.name?.split('.')[0]) || 'track'
    const pieces = runs.map((run, k) => {
      const piece = makeTrack(track, els.slice(run.from, run.to + 1), generateId(), sliceHeights(track.heights, run.s0, run.s1))
      if (k > 0 && track.name) {
        piece.name = nextTrackName(prefix, names)
        names.add(piece.name)
      }
      return { ...run, track: piece }
    })
    replaced.set(trackId, pieces.map(r => r.track))

    const keepsBegin = !gone.has(0), keepsEnd = !gone.has(els.length - 1)
    if (!keepsBegin) deadEnds.push({ trackId, endpoint: 'BEGIN' })
    if (!keepsEnd) deadEnds.push({ trackId, endpoint: 'END' })
    remap.push({ oldId: trackId, newId: [keepsBegin ? pieces[0].track.id : null, keepsEnd ? pieces[pieces.length - 1].track.id : null] })
    logged.push({ oldId: trackId, newId: pieces.map(r => r.track.id) })

    platforms = platforms?.flatMap(pl => {
      if (pl.trackId !== trackId) return [pl]
      const lo = Math.min(pl.startStation ?? 0, pl.endStation ?? 0), hi = Math.max(pl.startStation ?? 0, pl.endStation ?? 0)
      const run = pieces.find(r => lo >= r.s0 - 1e-6 && hi <= r.s1 + 1e-6)
      return run ? [{ ...pl, trackId: run.track.id,
        startStation: (pl.startStation ?? 0) - run.s0, endStation: (pl.endStation ?? 0) - run.s0 }] : []
    })
  }

  if (!replaced.size && !emptied.length) return project

  // The switches standing at a deleted end go, as deleteTrack lets them.
  const dead = new Set(deadEnds.map(e => `${e.trackId}|${e.endpoint}`))
  const doomed = (project.switches ?? []).filter(sw => portsOf(sw).some(pt => dead.has(`${sw[pt.trackKey]}|${sw[pt.endKey]}`)))
  let next = {
    ...project,
    tracks: (project.tracks ?? []).flatMap(t => replaced.get(t.id) ?? [t]),
    ...(platforms ? { platforms } : {}),
  }
  next = withoutSwitches(next, doomed)
  next = {
    ...next,
    switches: remapSwitches(next.switches ?? [], remap),
    endMarks: remapEndMarks(next.endMarks, remap, deadEnds),
  }
  logRemap(next, logged)
  return emptied.reduce(withoutTrack, next)
}

/**
 * Append elements to a track's end, as one undo step — what a connect dialog
 * commits (a transition and the element after it are one change).
 */
export function addElementsToTrack(trackId, elements) {
  return mutate(p => {
    const track = (p.tracks ?? []).find(t => t.id === trackId)
    if (!track || !elements?.length) return p
    const updated = withAppended(track, elements)
    return { ...p, tracks: p.tracks.map(t => (t.id === trackId ? updated : t)) }
  })
}

/** `track` with `elements` appended at its end, stations and polyline carried on. */
function withAppended(track, elements) {
  let els = track.elements ?? []
  let coords = track.coordinates ?? []
  for (const element of elements) {
    const last = els[els.length - 1]
    const prevAbsLength = last ? (last.absLength ?? last.length) : 0
    const withAbs = { ...element, absLength: prevAbsLength + element.length }
    els = [...els, withAbs]
    // The same polyline rebuildCoords and the reload take, which is the coarse one
    // wherever the element carries it: appending the fine one instead left the
    // track drawn at one density until a reload replaced it with the other.
    const c = withAbs.renderCoords ?? withAbs.geometry?.coordinates
    if (c?.length) coords = [...coords, ...c.slice(1)]
  }
  return { ...track, elements: els, coordinates: coords }
}

export function addElementToTrack(trackId, element) {
  return addElementsToTrack(trackId, [element])
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

/**
 * Write back a track whose stretch was reconnected (Paket N), as one undo
 * step: the track as commands/reconnect built it, and the platforms along it
 * re-stationed by `map` (old station → new station). Its id and ends stay, so
 * switches and end marks on it stay as they are.
 */
export function commitReconnect(track, map) {
  return mutate(p => ({
    ...p,
    tracks: (p.tracks ?? []).map(t => (t.id === track.id ? track : t)),
    ...(p.platforms ? {
      platforms: p.platforms.map(pl => (pl.trackId !== track.id ? pl : {
        ...pl, startStation: map(pl.startStation ?? 0), endStation: map(pl.endStation ?? 0),
      })),
    } : {}),
  }))
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

// ── measured axes ───────────────────────────────────────────────────────────

// (read through useAxisSurveys, hooks/useStore)

/** Add a measured axis, or replace the one with its id. One undo step. */
export function saveAxisSurvey(survey) {
  return mutate(p => ({ ...p, axisSurveys: [...(p.axisSurveys ?? []).filter(s => s.id !== survey.id), survey] }))
}

export function deleteAxisSurvey(surveyId) {
  return mutate(p => ({ ...p, axisSurveys: (p.axisSurveys ?? []).filter(s => s.id !== surveyId) }))
}

// ── reference axes (Bestandsachsen, Paket V) ───────────────────────────────

// (read through useReferenceAxes, hooks/useStore)

/** Add a reference axis, or replace the one with its id. One undo step. */
export function saveReferenceAxis(axis) {
  return mutate(p => ({ ...p, referenceAxes: [...(p.referenceAxes ?? []).filter(a => a.id !== axis.id), axis] }))
}

export function deleteReferenceAxis(axisId) {
  return mutate(p => ({ ...p, referenceAxes: (p.referenceAxes ?? []).filter(a => a.id !== axisId) }))
}

// ── routes (Paket RT) ───────────────────────────────────────────────────────

// (read through useRoutes, hooks/useStore; resolved through utils/routes)

/** Add a route, or replace the one with its id. One undo step. */
export function saveRoute(route) {
  return mutate(p => {
    const routes = p.routes ?? []
    const i = routes.findIndex(r => r.id === route.id)
    return { ...p, routes: i < 0 ? [...routes, route] : routes.map(r => (r.id === route.id ? route : r)) }
  })
}

export function deleteRoute(routeId) {
  return mutate(p => ({ ...p, routes: (p.routes ?? []).filter(r => r.id !== routeId) }))
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
 * @param {object[]} [ops.append]        [{ trackId, elements }] appended to standing tracks
 *                                       (a trailing turnout's through route)
 */
export function commitSwitchConnection({ removeTrackIds = [], addTracks, addSwitches, remap, addEndMarks, append = [], consumed = [] }) {
  return mutate(p => {
    const removeSet = new Set(removeTrackIds)
    const appendTo = new Map(append.map(a => [a.trackId, a.elements]))
    let next = {
      ...p,
      tracks: (p.tracks ?? [])
        .filter(t => !removeSet.has(t.id))
        .map(t => (appendTo.has(t.id) ? withAppended(t, appendTo.get(t.id)) : t))
        .concat(addTracks ?? []),
    }
    if (remap?.length) {
      next = { ...next, switches: remapSwitches(next.switches ?? [], remap), endMarks: remapEndMarks(next.endMarks, remap, consumed) }
      logRemap(next, remap)
    }
    next = { ...next, switches: [...(next.switches ?? []), ...(addSwitches ?? [])] }
    if (addEndMarks?.length) next = { ...next, endMarks: [...(next.endMarks ?? []), ...addEndMarks] }
    return next
  })
}

/**
 * Add what an import brought — tracks, switches, end marks, and fields of the
 * project record such as the RailJSON passthrough — as one undo step.
 */
export function commitImport({ addTracks = [], addSwitches = [], addEndMarks = [], patch = null }) {
  return mutate(p => ({
    ...p,
    ...(patch ?? {}),
    tracks: [...(p.tracks ?? []), ...addTracks],
    switches: [...(p.switches ?? []), ...addSwitches],
    endMarks: [...(p.endMarks ?? []), ...addEndMarks],
  }))
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
