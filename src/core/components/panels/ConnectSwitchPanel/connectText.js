const fmtR = (r) => (r == null ? '∞' : `${Math.round(r)} m`)
const fmtL = (l) => `${l.toFixed(3)} m`

/**
 * How the connecting element of "an Gleis anschließen" reads in one line, before
 * and after it is refitted: its kind, length and radius (both ends of a
 * transition).
 */
export function elementText(t, el) {
  if (!el) return '–'
  if (el.elementType === 2) return `${t('table_type_transition')} ${fmtL(el.length)}, ${fmtR(el.r1)} → ${fmtR(el.r2)}`
  if (el.elementType === 1) return `${t('table_type_arc')} ${fmtL(el.length)}, R ${fmtR(el.radius)}`
  return `${t('table_type_straight')} ${fmtL(el.length)}`
}
