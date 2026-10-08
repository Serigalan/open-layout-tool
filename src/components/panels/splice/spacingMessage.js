// What a dialog says about the spacing a splice keeps to a neighbouring track
// (Entscheidung 167) — the splice and reconnecting (Entscheidung 201) alike.

/**
 * What the dialog says about the spacing to the neighbour: the tightest place
 * with the spacing it has and the one asked for there (the minimum and what
 * the cant adds), with the search the radius it found.
 */
export function spacingMessage(t, fill, c, refName) {
  if (!c) return null
  const found = c.maximized ? fill('splice_clearance_found', { r: String(c.radius), u: String(Math.round(c.cant)) }) + ' ' : ''
  if (!c.near) return { msg: found + fill('splice_clearance_far', { track: refName }), error: false }
  const mm = (u) => String(Math.round(Math.abs(u)))
  const text = fill(c.kept ? 'splice_clearance_kept' : 'splice_clearance_short', {
    track: refName, d: c.distance.toFixed(2), req: c.required.toFixed(2),
    add: (c.required - c.dMin).toFixed(2), u1: mm(c.cantNew), u2: mm(c.cantRef),
  })
  return { msg: found + text, error: !c.kept }
}
