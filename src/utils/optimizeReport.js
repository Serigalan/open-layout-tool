// Formats the "grund" the optimizer attaches to a changed report row (AP R.4,
// olt_optimizer/optimize.py: binding_reason) into a translation key plus the
// numbers to fill its placeholders with. A pure function, not JSX, so it runs
// without a DOM — the same split the panel already keeps between fetching and
// rendering a result.

const UNIT_BY_RULE = {
  zielgeschwindigkeit: { scale: 1, decimals: 0 },     // km/h, as the service sends it
  weiche: { scale: 1, decimals: 0 },                  // mm
  ueberhoehung: { scale: 1, decimals: 0 },            // mm
  korridor: { scale: 100, decimals: 1 },              // m → cm
  rampenregel: { scale: 1, decimals: 1 },             // m
}

/**
 * `grund` as it arrives on a report row: { regel, ist, soll, arc?, slot? } or
 * undefined/null on an unchanged row. Returns null for either of those, or
 * { key, ist, soll } ready for `t(key).replace('{{ist}}', ist).replace(...)`.
 */
export function formatGrund(grund) {
  if (!grund?.regel) return null
  const unit = UNIT_BY_RULE[grund.regel]
  if (!unit) return null
  const fmt = (v) => (v * unit.scale).toFixed(unit.decimals)
  return { key: `optimize_grund_${grund.regel}`, ist: fmt(grund.ist), soll: fmt(grund.soll) }
}

/** `t(...)`'s result with `{{ist}}`/`{{soll}}` filled in, or '' where there is
 *  no grund to show (an unchanged row). */
export function grundText(t, grund) {
  const formatted = formatGrund(grund)
  if (!formatted) return ''
  return t(formatted.key).replace('{{ist}}', formatted.ist).replace('{{soll}}', formatted.soll)
}
