import { dehydrateProjects } from '../persistenceUtils'
import {
  COLLECTION_NAMES, fieldsOf, indexCollection, objectLabel, projectFields, sameValue,
} from './collections'

/**
 * A project record as merged: dehydrated, so the derived geometry (WGS84
 * polylines, switch symbols, platform polygons) neither counts as a change nor
 * rides into the result. A record that is dehydrated already passes unchanged.
 */
export const primary = (project) => dehydrateProjects([project ?? {}])[0]

/** The fields in which two versions of one object differ. */
function changedFields(collection, a, b) {
  const fa = collection ? fieldsOf(collection, a) : projectFields(a)
  const fb = collection ? fieldsOf(collection, b) : projectFields(b)
  const names = new Set([...fa.keys(), ...fb.keys()])
  return [...names].filter(name => !sameValue(fa.get(name), fb.get(name)))
}

/**
 * What changed from `base` to `other`, collection by collection:
 *
 *   { project: { changed: [field] },
 *     tracks:  { added: [id], removed: [id], changed: [{ id, fields: [field] }] },
 *     … the same for switches, platforms, kmLines, endMarks }
 *
 * Ids are strings (a km line goes by its number). Every entry also carries
 * the object's label, so a list of changes can be read without the records.
 */
export function diffProject(base, other) {
  const a = primary(base)
  const b = primary(other)
  const result = { project: { changed: changedFields(null, a, b) } }
  for (const name of COLLECTION_NAMES) {
    const before = indexCollection(a, name)
    const after  = indexCollection(b, name)
    const added = [], removed = [], changed = []
    for (const [id, obj] of after) {
      if (!before.has(id)) { added.push({ id, label: objectLabel(name, obj) }); continue }
      const fields = changedFields(name, before.get(id), obj)
      if (fields.length) changed.push({ id, label: objectLabel(name, obj), fields })
    }
    for (const [id, obj] of before) {
      if (!after.has(id)) removed.push({ id, label: objectLabel(name, obj) })
    }
    result[name] = { added, removed, changed }
  }
  return result
}

/** How many objects a diff touches (project fields count one each). */
export function diffSize(diff) {
  let n = diff.project.changed.length
  for (const name of COLLECTION_NAMES) {
    n += diff[name].added.length + diff[name].removed.length + diff[name].changed.length
  }
  return n
}

/** The diff as a flat list: { collection, id, label, kind: added|removed|changed, fields? }. */
export function diffEntries(diff) {
  const list = diff.project.changed.map(field => ({ collection: 'project', id: field, label: field, kind: 'changed', fields: [field] }))
  for (const name of COLLECTION_NAMES) {
    for (const e of diff[name].added)   list.push({ collection: name, ...e, kind: 'added' })
    for (const e of diff[name].removed) list.push({ collection: name, ...e, kind: 'removed' })
    for (const e of diff[name].changed) list.push({ collection: name, ...e, kind: 'changed' })
  }
  return list
}
