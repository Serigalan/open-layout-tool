import { trackLabel } from './trackModel'

// What one step of the project did, in a few words (R10.1) — for the undo and
// redo buttons. Worked out from the two states rather than told by each
// writer: the store is immutable, so whatever kept its object did not change,
// and the parts that did say what happened.

const byId = (list, key = 'id') => new Map((list ?? []).map(x => [x[key], x]))

/** The records of `before` and `after` that came, went, or are new objects under the same id. */
function delta(before, after, key = 'id') {
  const a = byId(before, key), b = byId(after, key)
  const added = [...b.values()].filter(x => !a.has(x[key]))
  const removed = [...a.values()].filter(x => !b.has(x[key]))
  const changed = [...b.values()].filter(x => a.has(x[key]) && a.get(x[key]) !== x)
  return { added, removed, changed }
}

const switchName = (sw) => sw.name || sw.label || sw.switchId?.slice(0, 8) || '?'
const platformName = (p) => [p.code, p.stationName].filter(Boolean).join(' · ') || p.id?.slice(0, 8) || '?'

/**
 * The step from `before` to `after` as { key, params }: a locale key and what
 * fills it. A switch is named before the tracks it brought along, and a whole
 * kind of change before a single one.
 */
export function describeStep(before, after) {
  if (!before || !after) return { key: 'step_project', params: {} }
  const sw = delta(before.switches, after.switches, 'switchId')
  if (sw.added.length) {
    return sw.added.length === 1
      ? { key: 'step_switch_added', params: { name: switchName(sw.added[0]) } }
      : { key: 'step_switches_added', params: { n: sw.added.length } }
  }
  const tr = delta(before.tracks, after.tracks)
  // A deleted switch takes its branch tracks along, a deleted track its
  // switches: one switch gone is a switch deleted, one track gone with
  // several switches is a track deleted.
  if (sw.removed.length && !(tr.removed.length === 1 && sw.removed.length > 1)) {
    return sw.removed.length === 1
      ? { key: 'step_switch_removed', params: { name: switchName(sw.removed[0]) } }
      : { key: 'step_switches_removed', params: { n: sw.removed.length } }
  }
  if (tr.added.length && tr.removed.length) {
    return { key: 'step_tracks_replaced', params: { removed: tr.removed.length, added: tr.added.length } }
  }
  if (tr.added.length) {
    return tr.added.length === 1
      ? { key: 'step_track_added', params: { name: trackLabel(tr.added[0]) } }
      : { key: 'step_tracks_added', params: { n: tr.added.length } }
  }
  if (tr.removed.length) {
    return tr.removed.length === 1
      ? { key: 'step_track_removed', params: { name: trackLabel(tr.removed[0]) } }
      : { key: 'step_tracks_removed', params: { n: tr.removed.length } }
  }
  if (sw.removed.length) {
    return sw.removed.length === 1
      ? { key: 'step_switch_removed', params: { name: switchName(sw.removed[0]) } }
      : { key: 'step_switches_removed', params: { n: sw.removed.length } }
  }
  if (tr.changed.length) {
    return tr.changed.length === 1
      ? { key: 'step_track_changed', params: { name: trackLabel(tr.changed[0]) } }
      : { key: 'step_tracks_changed', params: { n: tr.changed.length } }
  }
  if (sw.changed.length) {
    return sw.changed.length === 1
      ? { key: 'step_switch_changed', params: { name: switchName(sw.changed[0]) } }
      : { key: 'step_switches_changed', params: { n: sw.changed.length } }
  }
  const pf = delta(before.platforms, after.platforms)
  for (const [list, key] of [[pf.added, 'step_platform_added'], [pf.removed, 'step_platform_removed'], [pf.changed, 'step_platform_changed']]) {
    if (list.length) return { key, params: { name: platformName(list[0]) } }
  }
  const as = delta(before.axisSurveys, after.axisSurveys)
  for (const [list, key] of [[as.added, 'step_axis_survey_added'], [as.removed, 'step_axis_survey_removed'], [as.changed, 'step_axis_survey_changed']]) {
    if (list.length) return { key, params: { name: list[0].name ?? '' } }
  }
  const ra = delta(before.referenceAxes, after.referenceAxes)
  for (const [list, key] of [[ra.added, 'step_reference_axis_added'], [ra.removed, 'step_reference_axis_removed'], [ra.changed, 'step_reference_axis_changed']]) {
    if (list.length) return { key, params: { name: list[0].name ?? '' } }
  }
  const em = delta(before.endMarks, after.endMarks)
  if (em.added.length) return { key: 'step_end_mark_added', params: {} }
  if (em.removed.length) return { key: 'step_end_mark_removed', params: {} }
  if (em.changed.length) return { key: 'step_end_mark_changed', params: {} }
  return { key: 'step_project', params: {} }
}

/** The ids of the tracks a step brought or changed — what the map shows it by. */
export function stepTrackIds(before, after) {
  if (!before || !after) return []
  const { added, changed } = delta(before.tracks, after.tracks)
  return [...added, ...changed].map(t => t.id)
}
