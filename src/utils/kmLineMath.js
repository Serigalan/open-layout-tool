/**
 * Where along a kilometrage line a point lies — the arithmetic behind the
 * overlay's readout, kept free of MapLibre so it can be checked against the
 * tiles on its own (see tools/check-km-math.mjs).
 */

/**
 * Web Mercator on the unit square.
 *
 * Finding where along a line a point lies has to happen in a plane, and over
 * the 100 m of one piece this one is as good as the projected plane the app
 * calculates its own geometry in: Mercator is conformal, so the foot of the
 * perpendicular is the same point, and its scale is constant over such a short
 * stretch to about 1e-5 — a hundredth of a millimetre on 100 m. What the
 * kilometrage is really limited by is the source, which states it in whole
 * metres.
 */
export function toMercator(lon, lat) {
  return [lon / 360, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)]
}

export function fromMercator(x, y) {
  return [x * 360, (Math.atan(Math.sinh(y * 2 * Math.PI)) * 180) / Math.PI]
}

/**
 * The kilometrage at `lngLat`, taken from whichever of the 100 m `pieces` runs
 * closest to it — each a GeoJSON feature carrying `km_begin` and `km_end`.
 *
 * Returns the interpolated value together with the point on the line it
 * belongs to and its distance from `lngLat` (in Mercator units, for comparing
 * candidates only), or null when none of the pieces can be measured along.
 */
export function kmOnPieces(pieces, lngLat) {
  const [cx, cy] = toMercator(lngLat.lng, lngLat.lat)
  let best = null

  for (const piece of pieces) {
    const { km_begin: kmBegin, km_end: kmEnd, strecke, in_db: inDb } = piece.properties ?? {}
    if (typeof kmBegin !== 'number' || typeof kmEnd !== 'number') continue
    const parts = piece.geometry.type === 'MultiLineString'
      ? piece.geometry.coordinates
      : [piece.geometry.coordinates]

    for (const part of parts) {
      const points = part.map(([lon, lat]) => toMercator(lon, lat))
      const cumulative = [0]
      for (let i = 1; i < points.length; i++) {
        cumulative.push(cumulative[i - 1] + Math.hypot(
          points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
      }
      const total = cumulative[cumulative.length - 1]
      if (!(total > 0)) continue

      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1]
        const dx = points[i][0] - ax
        const dy = points[i][1] - ay
        const squared = dx * dx + dy * dy
        if (squared === 0) continue
        const t = Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / squared))
        const px = ax + t * dx
        const py = ay + t * dy
        const distance = Math.hypot(cx - px, cy - py)
        if (best && distance >= best.distance) continue
        const along = cumulative[i - 1] + t * Math.sqrt(squared)
        best = {
          distance,
          km: kmBegin + (along / total) * (kmEnd - kmBegin),
          strecke,
          inDb: inDb !== 0,   // an archive built before the status existed carries none
          lngLat: fromMercator(px, py),
        }
      }
    }
  }
  return best
}

/**
 * 171034.7 → "171,0 + 35" — the kilometrage as the survey data writes it:
 * kilometre, hectometre, and the metres counted from that hectometre mark.
 * Before km 0 the source writes both parts negative ("-0,4 + -44"), so this
 * does too — someone comparing a readout against the data should find the
 * same string.
 */
export function formatKm(metres) {
  const negative = metres < 0
  const total = Math.abs(Math.round(metres))
  const km = Math.floor(total / 1000)
  const rest = total - km * 1000
  return `${negative ? '-' : ''}${km},${Math.floor(rest / 100)} + ${negative ? '-' : ''}${rest % 100}`
}
