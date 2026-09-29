/**
 * SVG path data as the plan model's commands: absolute M, L, C and Z only, so
 * a shape drawn in another program — a logo, a symbol — can be set on a plan
 * and reach the SVG and the PDF backend alike. Relative commands are made
 * absolute, H and V become lines, quadratic curves and arcs become cubics.
 */

const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** The commands of a path string with their numbers, in order. */
function tokens(d) {
  const out = []
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g
  let cur = null
  for (const m of d.matchAll(re)) {
    if (m[1]) {
      cur = { cmd: m[1], nums: [] }
      out.push(cur)
    } else if (cur) {
      cur.nums.push(Number(m[2]))
    }
  }
  return out
}

/**
 * An arc as cubic segments (SVG implementation notes, F.6): the endpoint
 * form is turned into centre form and each quarter turn or less is one cubic.
 */
function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]]
  const phi = phiDeg * Math.PI / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  const k = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cxp = k * rx * yp / ry
  const cyp = -k * ry * xp / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI

  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
  const step = dt / n
  const alpha = 4 / 3 * Math.tan(step / 4)
  const point = (t) => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ]
  const deriv = (t) => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ]
  const out = []
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step
    const b = a + step
    const [ax, ay] = point(a)
    const [bx, by] = i === n - 1 ? [x2, y2] : point(b)
    const [dax, day] = deriv(a)
    const [dbx, dby] = deriv(b)
    out.push([ax + alpha * dax, ay + alpha * day, bx - alpha * dbx, by - alpha * dby, bx, by])
  }
  return out
}

/** Path data → [['M', x, y], ['L', x, y], ['C', x1, y1, x2, y2, x, y], ['Z']]. */
export function parseSvgPath(d) {
  const out = []
  let x = 0, y = 0          // current point
  let sx = 0, sy = 0        // start of the subpath
  let cx = null, cy = null  // last cubic control point, for S
  let qx = null, qy = null  // last quadratic control point, for T

  for (const { cmd, nums } of tokens(d)) {
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const n = ARGS[up]
    if (up === 'Z') {
      out.push(['Z'])
      x = sx; y = sy
      cx = cy = qx = qy = null
      continue
    }
    for (let i = 0; i + n <= nums.length; i += n) {
      const a = nums.slice(i, i + n)
      const ox = rel ? x : 0
      const oy = rel ? y : 0
      let nextC = null
      let nextQ = null
      if (up === 'M') {
        x = a[0] + ox; y = a[1] + oy
        // Pairs after the first of a moveto are implicit linetos.
        if (i === 0) { out.push(['M', x, y]); sx = x; sy = y } else out.push(['L', x, y])
      } else if (up === 'L') {
        x = a[0] + ox; y = a[1] + oy
        out.push(['L', x, y])
      } else if (up === 'H') {
        x = a[0] + ox
        out.push(['L', x, y])
      } else if (up === 'V') {
        y = a[0] + oy
        out.push(['L', x, y])
      } else if (up === 'C') {
        const c = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy]
        out.push(['C', ...c])
        nextC = [c[2], c[3]]
        x = c[4]; y = c[5]
      } else if (up === 'S') {
        const [rx1, ry1] = cx == null ? [x, y] : [2 * x - cx, 2 * y - cy]
        const c = [rx1, ry1, a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy]
        out.push(['C', ...c])
        nextC = [c[2], c[3]]
        x = c[4]; y = c[5]
      } else if (up === 'Q' || up === 'T') {
        const [px, py] = up === 'Q' ? [a[0] + ox, a[1] + oy]
          : qx == null ? [x, y] : [2 * x - qx, 2 * y - qy]
        const [ex, ey] = up === 'Q' ? [a[2] + ox, a[3] + oy] : [a[0] + ox, a[1] + oy]
        // A quadratic is the cubic with its control points two thirds of the way to the quadratic's.
        out.push(['C', x + 2 / 3 * (px - x), y + 2 / 3 * (py - y), ex + 2 / 3 * (px - ex), ey + 2 / 3 * (py - ey), ex, ey])
        nextQ = [px, py]
        x = ex; y = ey
      } else if (up === 'A') {
        const [ex, ey] = [a[5] + ox, a[6] + oy]
        for (const c of arcToCubics(x, y, a[0], a[1], a[2], a[3] ? 1 : 0, a[4] ? 1 : 0, ex, ey)) {
          out.push(['C', ...c])
        }
        x = ex; y = ey
      }
      ;[cx, cy] = nextC ?? [null, null]
      ;[qx, qy] = nextQ ?? [null, null]
    }
  }
  return out
}
