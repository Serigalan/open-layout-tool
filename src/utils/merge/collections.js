/**
 * What a project record is made of, for comparing and merging two states of it.
 *
 * A record is the dehydrated project (persistenceUtils.dehydrateProjects): the
 * collections below, each keyed by its own id, and the project's own fields
 * beside them. Within a collection an object is compared field by field, and a
 * "field" is whatever is merged as one value — for a track `elements` and
 * `heights` are one field each (the elements carry no ids of their own,
 * decision 92), for a switch every port field together is one field, and a
 * km line or an end mark is one value altogether.
 */

const PORT_FIELD = /^port[A-Z0-9]+_(trackId|endpoint)$/

/** The value the "whole entry" collections are compared as. */
export const WHOLE = '*'

/** The port fields of a switch, merged as one. */
export const PORTS = 'ports'

export const COLLECTIONS = [
  { name: 'tracks',    key: 'id' },
  { name: 'switches',  key: 'switchId' },
  { name: 'platforms', key: 'id' },
  { name: 'kmLines',   key: 'lineNumber', whole: true },
  { name: 'endMarks',  key: 'id', whole: true },
]

export const COLLECTION_NAMES = COLLECTIONS.map(c => c.name)

const BY_NAME = Object.fromEntries(COLLECTIONS.map(c => [c.name, c]))

export const collectionOf = (name) => BY_NAME[name]

/** The id an object goes by in its collection, as a string (km lines are numbered). */
export const keyOf = (collection, obj) => String(obj?.[BY_NAME[collection].key])

/** The objects of a collection by id. */
export function indexCollection(project, collection) {
  const map = new Map()
  for (const obj of project?.[collection] ?? []) map.set(keyOf(collection, obj), obj)
  return map
}

/**
 * An object split into the values it is merged as: field name → value. A field
 * that is absent is simply not in the map — absent and `undefined` are one.
 */
export function fieldsOf(collection, obj) {
  const fields = new Map()
  if (BY_NAME[collection].whole) {
    fields.set(WHOLE, obj)
    return fields
  }
  const ports = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined) continue
    if (collection === 'switches' && PORT_FIELD.test(k)) ports[k] = v
    else fields.set(k, v)
  }
  if (Object.keys(ports).length) fields.set(PORTS, ports)
  return fields
}

/** The inverse of fieldsOf. */
export function objectFromFields(collection, fields) {
  if (BY_NAME[collection].whole) return fields.get(WHOLE)
  const obj = {}
  for (const [k, v] of fields) {
    if (v === undefined) continue
    if (k === PORTS) Object.assign(obj, v)
    else obj[k] = v
  }
  return obj
}

/** The project's own fields: everything that is not one of the collections. */
export function projectFields(project) {
  const fields = new Map()
  for (const [k, v] of Object.entries(project ?? {})) {
    if (v === undefined || BY_NAME[k]) continue
    fields.set(k, v)
  }
  return fields
}

/**
 * Stable text of a value, for telling whether two values are the same: object
 * keys sorted, `undefined` members left out (JSON drops them the same way).
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : canonical(v))).join(',')}]`
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
}

export const sameValue = (a, b) => canonical(a) === canonical(b)

/**
 * What a person calls an object, for the conflict texts: a track by its line
 * and track number (or its name), a switch by its name or label, a platform by
 * its station name.
 */
export function objectLabel(collection, obj) {
  if (!obj) return null
  if (collection === 'tracks') {
    if (obj.lineNumber != null && obj.trackNumber != null) return `${obj.lineNumber}-${obj.trackNumber}`
    return obj.name ?? obj.id
  }
  if (collection === 'switches') return obj.name ?? obj.label ?? obj.switchId
  if (collection === 'platforms') return [obj.stationName, obj.code].filter(Boolean).join(' ') || obj.id
  if (collection === 'kmLines') return String(obj.lineNumber)
  return obj.id ?? null
}
