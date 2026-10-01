import {
  COLLECTION_NAMES, WHOLE, fieldsOf, indexCollection, keyOf, objectFromFields, objectLabel,
  projectFields, sameValue,
} from './collections'
import { primary } from './diff'
import { carryReferences, remapKind } from './remap'

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
 * Returns { merged, conflicts, applied }:
 *   merged    – the dehydrated record, every conflict decided for `mine`
 *   conflicts – [{ id, kind, collection, objectId, field, label, base, mine,
 *               theirs, hint }], `field` null where the conflict is about the
 *               object as a whole (deleted against changed); the values are
 *               what the field (or object) is on each side, `undefined` absent
 *   applied   – what was taken over from `theirs`:
 *               [{ collection, id, label, kind: added|removed|changed|carried, fields }]
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

  // ── the collections ──
  for (const name of COLLECTION_NAMES) {
    const bi = indexCollection(B, name), mi = indexCollection(M, name), ti = indexCollection(T, name)
    if (!B[name] && !M[name] && !T[name]) continue
    const out = new Map()

    // Mine's order first, then what only theirs has, in theirs' order.
    const ids = [...mi.keys(), ...[...ti.keys()].filter(id => !mi.has(id)), ...[...bi.keys()].filter(id => !mi.has(id) && !ti.has(id))]
    for (const id of ids) {
      const b = bi.get(id), m = mi.get(id), t = ti.get(id)
      const label = objectLabel(name, m ?? t ?? b)

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

  const context = { base: B, mine: M, theirs: T, remapsMine, remapsTheirs }
  const { project, carried } = carry(merged, context)
  for (const c of carried) {
    applied.push({ collection: c.collection, id: c.id, label: null, kind: 'carried', from: c.from, to: c.to })
  }
  return { merged: project, conflicts, applied, context }
}

/**
 * The record with every conflict decided: `choices` maps a conflict id to
 * 'mine' or 'theirs' (unnamed ones stay 'mine'). The references are carried
 * over again afterwards — taking a side can bring back one that names a track
 * the other side split.
 */
export function resolve(mergeResult, choices = {}) {
  const record = structuredClone(mergeResult.merged)
  for (const c of mergeResult.conflicts) {
    if ((choices[c.id] ?? 'mine') !== 'theirs') continue
    applyChoice(record, c, c.theirs)
  }
  return carry(record, mergeResult.context).project
}

/** Write the value of one side of a conflict into the record. */
export function applyChoice(record, c, value) {
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
