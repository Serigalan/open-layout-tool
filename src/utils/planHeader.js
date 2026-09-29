/**
 * The editable fields of a plan's title block. The parties follow the columns
 * of the block from left to right; only those that sign get the lines for
 * place, date and signature.
 */
export const PARTIES = [
  { key: 'owner',      labelKey: 'plan_party_owner',      signs: true },
  { key: 'lead',       labelKey: 'plan_party_lead',       signs: true },
  { key: 'contractor', labelKey: 'plan_party_contractor', signs: false },
  { key: 'planner',    labelKey: 'plan_party_planner',    signs: true },
]
export const STAFF = [
  { key: 'drawn',    labelKey: 'plan_staff_drawn' },
  { key: 'edited',   labelKey: 'plan_staff_edited' },
  { key: 'checked',  labelKey: 'plan_staff_checked' },
]

export const emptyHeader = () => ({
  subtitle: '',
  range: '',
  index: '',
  code: '',
  sketch: null,
  parties: Object.fromEntries(PARTIES.map(p => [p.key, { address: '', logo: null }])),
  staff: Object.fromEntries(STAFF.map(s => [s.key, { date: '', name: '' }])),
})

/** Stored header merged over the empty one, so a field added later is never missing. */
export const normalizeHeader = (stored) => {
  const base = emptyHeader()
  return {
    subtitle: stored?.subtitle ?? '',
    range: stored?.range ?? '',
    index: stored?.index ?? '',
    code: stored?.code ?? '',
    sketch: stored?.sketch ?? null,
    parties: Object.fromEntries(PARTIES.map(p => [p.key, { ...base.parties[p.key], ...stored?.parties?.[p.key] }])),
    staff: Object.fromEntries(STAFF.map(s => [s.key, { ...base.staff[s.key], ...stored?.staff?.[s.key] }])),
  }
}
