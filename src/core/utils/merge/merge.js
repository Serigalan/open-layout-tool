import {
  COLLECTION_NAMES, WHOLE, fieldsOf, indexCollection, keyOf, objectFromFields, objectLabel,
  projectFields, sameValue,
} from './collections'
import { primary } from './diff'
import { carryReferences, remapKind } from './remap'
import { newFindings, validateProject } from '../validateProject'

/**
 * Three-way merge of two states of a project against the state both came from
 * (merge rules 1–5 in the roadmap, phase 10).
 *
 *   base   – the common ancestor
 *   mine   – the state the result is written into (the working copy, the
 *            target variant)
 *   theirs – the state whose changes are taken over
 *   remapsMine / remapsTheirs – the id logs ({ from, to: [ids] }) of the
 *            splits and joins each side made since base (decision 93)
 *
 * Returns { merged, conflicts, warnings, applied, context }:
 *   merged    – the dehydrated record, every conflict decided for `mine`
 *   conflicts – [{ id, kind, collection, objectId, field, label, base, mine,
 *               theirs, hint }], `field` null where the conflict is about the
 *               object as a whole (deleted against changed); the values are
 *               what the field (or object) is on each side, `undefined` absent.
 *               Last come the validation conflicts (rule 7, see
 *               validationConflicts), one per object a new error names.
 *   warnings  – validation warnings the merge brought in (not in `mine`)
 *   applied   – what was taken over from `theirs`:
 *               [{ collection, id, label, kind: added|removed|changed|carried, fields }]
 *   context   – the three states and both id logs, which resolve needs
 *
 * The derived geometry (rule 6) is not rebuilt here: the result is a
 * dehydrated record, and whoever adopts it hydrates it (hydrateProjects) —
 * validation needs only the plane data.
 *
 * Nothing here repairs. Where both sides changed the same thing differently it
 * is a conflict, decided by choosing a side (resolve), never by mixing them.
 */
export function mergeProject({ base, mine, theirs, remapsMine = [], remapsTheirs = [] }) {
  const B = primary(base), M = primary(mine), T = primary(theirs)
  const conflicts = []
  const applied = []

  // ── the project's own fields ──
  const projectOut = mergeFieldMaps(projectFields(B), projectFields(M), projectFields(T), {
    onConflict: (field, b, m, t) => conflicts.push(conflict('project', 'project', field, field, b, m, t, 'field')),
    onTaken: (fields) => applied.push({ collection: 'project', id: 'project', label: null, kind: 'changed', fields }),
  })
  const merged = Object.fromEntries(projectOut)

  // The tracks of all three states, for naming an end mark by its track.
  const allTracks = new Map([...(B.tracks ?? []), ...(T.tracks ?? []), ...(M.tracks ?? [])].map(t => [t.id, t]))

  // ── the collections ──
  for (const name of COLLECTION_NAMES) {
    const bi = indexCollection(B, name), mi = indexCollection(M, name), ti = indexCollection(T, name)
    if (!B[name] && !M[name] && !T[name]) continue
    const out = new Map()

    // Mine's order first, then what only theirs has, in theirs' order.
    const ids = [...mi.keys(), ...[...ti.keys()].filter(id => !mi.has(id)), ...[...bi.keys()].filter(id => !mi.has(id) && !ti.has(id))]
    for (const id of ids) {
      const b = bi.get(id), m = mi.get(id), t = ti.get(id)
      const label = objectLabel(name, b ?? m ?? t, allTracks)

      if (m && t) {
        if (!b && !sameValue(m, t)) {
          // New on both sides under one id: only a km line can be (it is keyed
          // by its number); anything else would be a UUID collision.
          conflicts.push(conflict(name, id, null, label, undefined, m, t, 'both_added'))
          out.set(id, m)
          continue
        }
        const fields = mergeFieldMaps(fieldsOf(name, b ?? {}), fieldsOf(name, m), fieldsOf(name, t), {
          onConflict: (field, fb, fm, ft) => conflicts.push(conflict(name, id, field, label, fb, fm, ft, 'field')),
          onTaken: (fs) => applied.push({ collection: name, id, label, kind: 'changed', fields: fs }),
        })
        out.set(id, objectFromFields(name, fields))
      } else if (m && !t) {
        if (!b) { out.set(id, m); continue }                   // added on my side
        if (sameValue(b, m)) {                                  // theirs deleted it, mine left it
          applied.push({ collection: name, id, label, kind: 'removed' })
          continue
        }
        conflicts.push(conflict(name, id, null, label, b, m, undefined, 'changed_deleted', remapKind(id, remapsTheirs)))
        out.set(id, m)
      } else if (!m && t) {
        if (!b) {                                               // added on their side
          applied.push({ collection: name, id, label, kind: 'added' })
          out.set(id, t)
          continue
        }
        if (sameValue(b, t)) continue                           // mine deleted it, theirs left it
        conflicts.push(conflict(name, id, null, label, b, undefined, t, 'deleted_changed', remapKind(id, remapsMine)))
      }
      // In base alone: deleted on both sides.
    }
    merged[name] = [...out.values()]
  }

  const context = {
    base: B, mine: M, theirs: T, remapsMine, remapsTheirs,
    // What mine already fails: only what the merge adds to that is its doing.
    known: validateProject(M),
  }
  const { project, carried } = carry(merged, context)
  for (const c of carried) {
    applied.push({ collection: c.collection, id: c.id, label: null, kind: 'carried', from: c.from, to: c.to })
  }
  const checked = validationConflicts(project, context)
  return { merged: project, conflicts: [...conflicts, ...checked.conflicts], warnings: checked.warnings, applied, context }
}

/**
 * The errors a merged record has that `mine` did not (rule 7), as conflicts —
 * one per object they name, decided like a deletion by taking the whole object
 * from one side: id `object:<collection>:<id>`, `mine` and `theirs` the object
 * on each side (`undefined` where a side has none), `findings` the errors.
 * Errors `mine` already had are not the merge's doing and do not block it.
 * Also returns the warnings that are new against `mine`.
 */
export function validationConflicts(record, context) {
  const { errors, warnings } = validateProject(record)
  const fresh = newFindings(errors, context.known?.errors)
  const byObject = new Map()
  for (const f of fresh) {
    const collection = f.collection
    const id = `object:${collection}:${f.id}`
    if (!byObject.has(id)) {
      const find = (p) => (p[collection] ?? []).find(o => keyOf(collection, o) === String(f.id))
      const obj = find(context.mine) ?? find(context.theirs) ?? find(record)
      const tracks = new Map([context.base, context.theirs, context.mine, record].flatMap(p => p.tracks ?? []).map(t => [t.id, t]))
      byObject.set(id, {
        id, kind: 'validation', collection, objectId: String(f.id), field: null,
        label: obj ? objectLabel(collection, obj, tracks) : f.label,
        base: find(context.base), mine: find(context.mine), theirs: find(context.theirs), findings: [],
      })
    }
    byObject.get(id).findings.push(f)
  }
  return { conflicts: [...byObject.values()], warnings: newFindings(warnings, context.known?.warnings) }
}

/**
 * The record with every conflict decided: `choices` maps a conflict id to
 * 'mine' or 'theirs' (unnamed field conflicts stay 'mine'). A choice under an
 * `object:<collection>:<id>` id — what a validation conflict offers — takes
 * that whole object from the side named, whichever validation found it. The
 * references are carried over again afterwards — taking a side can bring back
 * one that names a track the other side split.
 */
export function resolve(mergeResult, choices = {}) {
  const { context } = mergeResult
  const record = structuredClone(mergeResult.merged)
  for (const c of mergeResult.conflicts) {
    if (c.kind === 'validation' || (choices[c.id] ?? 'mine') !== 'theirs') continue
    applyChoice(record, c, c.theirs)
  }
  for (const [id, side] of Object.entries(choices)) {
    const m = /^object:([^:]+):(.+)$/.exec(id)
    if (!m) continue
    const [, collection, objectId] = m
    const from = side === 'theirs' ? context.theirs : context.mine
    const value = (from[collection] ?? []).find(o => keyOf(collection, o) === objectId)
    applyChoice(record, { collection, objectId, field: null }, value)
  }
  return carry(record, context).project
}

/** Write the value of one side of a conflict into the record. */
function applyChoice(record, c, value) {
  if (c.collection === 'project') {
    if (value === undefined) delete record[c.field]
    else record[c.field] = value
    return
  }
  const list = record[c.collection] ?? (record[c.collection] = [])
  const at = list.findIndex(o => keyOf(c.collection, o) === c.objectId)
  if (c.field == null) {
    if (value === undefined) { if (at >= 0) list.splice(at, 1) }
    else if (at >= 0) list[at] = value
    else list.push(value)
    return
  }
  if (at < 0) return
  const fields = fieldsOf(c.collection, list[at])
  if (value === undefined) fields.delete(c.field); else fields.set(c.field, value)
  list[at] = objectFromFields(c.collection, fields)
}

function carry(record, context) {
  const { base, mine, theirs, remapsMine, remapsTheirs } = context
  const tracksOf = (p) => new Map((p.tracks ?? []).map(t => [t.id, t]))
  const sources = [tracksOf(base), tracksOf(theirs), tracksOf(mine)]
  const oldTrack = (id) => sources.map(s => s.get(id)).find(Boolean) ?? null
  return carryReferences(record, [remapsMine, remapsTheirs], oldTrack)
}

/**
 * Merge two maps of field values against a base map (rule 2): a field only one
 * side changed takes that side's value; both changed it alike, no conflict;
 * differently, a conflict, and mine stands.
 */
function mergeFieldMaps(b, m, t, { onConflict, onTaken }) {
  const out = new Map()
  const taken = []
  for (const field of new Set([...m.keys(), ...t.keys(), ...b.keys()])) {
    const vb = b.get(field), vm = m.get(field), vt = t.get(field)
    const mineChanged = !sameValue(vb, vm), theirsChanged = !sameValue(vb, vt)
    let v = vm
    if (!mineChanged && theirsChanged) { v = vt; taken.push(field) }
    else if (mineChanged && theirsChanged && !sameValue(vm, vt)) onConflict(field, vb, vm, vt)
    if (v !== undefined) out.set(field, v)
  }
  if (taken.length) onTaken(taken)
  return out
}

function conflict(collection, objectId, field, label, base, mine, theirs, kind, hint = null) {
  return {
    id: `${collection}:${objectId}:${field ?? WHOLE}`,
    kind, collection, objectId, field, label,
    base, mine, theirs,
    ...(hint ? { hint } : {}),
  }
}
