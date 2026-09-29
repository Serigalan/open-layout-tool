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

export const BLOCK_STYLES = ['compact', 'full']

const pad = (n) => String(n).padStart(2, '0')

/** Today as the date input holds it (yyyy-mm-dd), in local time. */
export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * A date as the calendar input takes it. Earlier versions kept what was
 * typed — 01/2026, 15.01.2026 — which becomes the day it names (the first of
 * the month where only the month was given); anything else stays as it was.
 */
export function toIsoDate(value) {
  const v = String(value ?? '').trim()
  let m = /^(\d{1,2})\/(\d{4})$/.exec(v)
  if (m) return `${m[2]}-${pad(m[1])}-01`
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return v
}

export const emptyHeader = () => ({
  style: 'compact',
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
    style: BLOCK_STYLES.includes(stored?.style) ? stored.style : 'compact',
    subtitle: stored?.subtitle ?? '',
    range: stored?.range ?? '',
    index: stored?.index ?? '',
    code: stored?.code ?? '',
    sketch: stored?.sketch ?? null,
    parties: Object.fromEntries(PARTIES.map(p => [p.key, { ...base.parties[p.key], ...stored?.parties?.[p.key] }])),
    staff: Object.fromEntries(STAFF.map(s => {
      const row = { ...base.staff[s.key], ...stored?.staff?.[s.key] }
      return [s.key, { ...row, date: toIsoDate(row.date) }]
    })),
  }
}
