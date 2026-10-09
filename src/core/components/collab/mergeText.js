/**
 * The words for what a comparison or a merge found — shared by the
 * comparison view, the conflict dialog and the check-in dialogs.
 */

import { fill, tOr } from '../../locales/i18n'



const translated = tOr

const collectionName = (t, collection) => translated(t, `coll_${collection}`, collection)

const fieldName = (t, field) => translated(t, `field_${field}`, field)

/** "Gleis 6050-1", "Weiche switch.001", "Projekt: Titel". */
function objectName(t, collection, label, id) {
  if (collection === 'project') return `${collectionName(t, 'project')}: ${fieldName(t, label ?? id)}`
  const name = String(label ?? String(id).slice(0, 8))
    .replace(/ BEGIN$/, ` · ${t('end_begin')}`).replace(/ END$/, ` · ${t('end_end')}`)
  return `${collectionName(t, collection)} ${name}`
}

const round = (v, digits = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v)

/** A validation finding as a sentence. */
export function findingText(t, f) {
  const params = Object.fromEntries(Object.entries(f.params ?? {}).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
  return translated(t, `valid_${f.code}`, f.code).replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m))
}

/** What a conflict is about, in one line. */
export function conflictText(t, c, { mineLabel, theirsLabel }) {
  const label = objectName(t, c.collection, c.label, c.objectId)
  if (c.kind === 'field') return fill(t, 'merge_kind_field', { label, field: fieldName(t, c.field) })
  if (c.kind === 'changed_deleted') return fill(t, 'merge_kind_changed_deleted', { label, mine: mineLabel, theirs: theirsLabel })
  if (c.kind === 'deleted_changed') return fill(t, 'merge_kind_deleted_changed', { label, mine: mineLabel, theirs: theirsLabel })
  if (c.kind === 'both_added') return fill(t, 'merge_kind_both_added', { label })
  return fill(t, 'merge_kind_validation', { label })
}

/** One side's value of a conflict, short enough for a row. */
export function valueText(t, c, value) {
  if (value === undefined) return t('merge_absent')
  if (c.field === 'elements' && Array.isArray(value)) {
    const length = value.reduce((s, e) => s + (e.length ?? 0), 0)
    return fill(t, 'merge_value_elements', { n: value.length, length: round(length, 1) })
  }
  if (c.field === 'heights' && Array.isArray(value)) return fill(t, 'merge_value_heights', { n: value.length })
  if (c.field === 'ports' && value && typeof value === 'object') {
    return Object.entries(value).filter(([k]) => k.endsWith('_endpoint'))
      .map(([k, v]) => `${k.replace(/^port|_endpoint$/g, '')}: ${v}`).join(', ')
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    const s = String(value)
    return s.length > 60 ? `${s.slice(0, 57)}…` : s
  }
  return t('merge_value_object')
}

/** A diff or merge entry ({ collection, label, id, kind, fields }) as a row text. */
export function entryText(t, e) {
  const name = objectName(t, e.collection, e.label ?? (e.collection === 'project' ? e.fields?.[0] : null), e.id)
  const fields = e.kind === 'changed' && e.collection !== 'project' && e.fields?.length
    ? ` — ${e.fields.map(f => fieldName(t, f)).join(', ')}` : ''
  return `${name}${fields}`
}
