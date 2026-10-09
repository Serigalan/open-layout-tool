/**
 * The vertical alignment of the DB ASCII interface — Satzart 22 with the point
 * heights of Satzart 13 and the stationing of Satzart 11 — as the `heights` a
 * track carries.
 *
 * The three parts fit together like this:
 *
 * - **Satzart 22** states the gradient as a chain of elements between point
 *   addresses, each with its length and the gradient in per mille before and
 *   after it. Where the two are equal the element is a slope; where they
 *   differ it is the rounding between two slopes, and its radius follows from
 *   how far the gradient turns over its length: `Rv = 1000 · L / Δi`.
 * - **Satzart 13** gives the height of those points, one per height system.
 *   The element names its own system (`EHSYS`, and the files met so far use
 *   `V00`, `N00`, `O00`, `T00`, `R00`), and the height in *that* system is the
 *   one that belongs to it — measured over five databases, every endpoint of
 *   every gradient element has one.
 * - **Satzart 11** stations the points along their line, which is what places
 *   the gradient on a track: the horizontal elements' own points are stationed
 *   the same way, so the two chains meet on the line and not on each other's
 *   addresses (they do not share any).
 *
 * `track.heights` is the tangent polygon — the intersection points of the
 * slopes, each with the radius that rounds it (heightUtils) — so a rounding
 * becomes one point at its middle, not two at its ends. Checked against the
 * delivered files from both sides: the intersection computed from the start of
 * a rounding and from its end agree to a hundredth of a millimetre.
 */

const padKey = (a, b) => `${a}\u0000${b}`

/** The Betriebsstelle a point address begins with. */
export const bstOf = (pad) => String(pad ?? '').slice(0, 4)

/** How far a gradient may fall short of a track's end and still be taken. */
const REACH_TOL = 0.5

/** Two stations closer than this are the same point. */
const SAME = 1e-3

/**
 * Station [m] from the field of Satzart 11 and 24, which comes in two forms.
 *
 * Along a **line** it is packed: the metres are the last two digits and the
 * hundred-metre block counts in ten thousands, so `101320005.372` is
 * 1 013 200 m plus 5.372 m. Along a **station track** it is plain metres —
 * `804.799` is 804.799 m.
 *
 * The two are told apart by size: a packed value carries at least a whole
 * kilometre of blocks (10 · 10 000), a station track's own station never
 * reaches a hundred kilometres. Measured over five databases against the
 * lengths between the stationed points — element by element, horizontal and
 * vertical — this reads 91 % of them to within half a metre where taking
 * every value as packed reads 77 %. What is left is the file's own
 * Fehlprofile, and `stationsAlong` refuses a chain where the stationing and
 * the lengths disagree beyond them.
 *
 * Null for a field that states nothing (0 is "not stationed" here, not km 0).
 */
export function mdbStation(value) {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return null
  return v < 100000 ? v : Math.floor(v / 10000) * 100 + (v % 100)
}

/** Where a point address sits: its station and the line it is stationed on. */
export function stationIndex(payload) {
  const station = new Map()
  const line = new Map()
  for (const s of payload?.stations ?? []) {
    const at = mdbStation(s?.station)
    if (at == null || station.has(s?.pad)) continue
    station.set(s.pad, at)
    line.set(s.pad, String(s?.strecke ?? '').trim())
  }
  return { station, line }
}

/** Order the gradient elements of one height system into chains. */
function chainsOf(elements) {
  const out = new Map()
  const into = new Set()
  for (const el of elements) {
    if (!out.has(el.pad1)) out.set(el.pad1, [])
    out.get(el.pad1).push(el)
    into.add(el.pad2)
  }
  const take = (pad) => {
    const list = out.get(pad)
    if (!list?.length) return null
    const el = list.shift()
    if (!list.length) out.delete(pad)
    return el
  }
  const walk = (start) => {
    const chain = []
    for (let cur = start, el = take(cur); el; el = take(cur)) {
      chain.push(el)
      cur = el.pad2
    }
    return chain
  }
  const chains = []
  for (const el of elements) {
    if (into.has(el.pad1)) continue
    const chain = walk(el.pad1)
    if (chain.length) chains.push(chain)
  }
  while (out.size) {
    const [key] = out.keys()
    const chain = walk(key)
    if (!chain.length) { out.delete(key); continue }
    chains.push(chain)
  }
  return chains
}

/**
 * Station of every point of a chain, in chain order — of a gradient as well
 * as of the horizontal chain a track is built from. Where the file states one
 * it is taken as it stands; where it does not, the element lengths fill the
 * gap from the nearest point that has one: the chain's own lengths are what
 * the stationing is made of, and one point without a record should not cost
 * the whole chain.
 *
 * `cum` is the distance from the chain's start to each point, so it has one
 * entry more than the chain has elements, like `pads`.
 *
 * Null where no point of the chain is stationed at all: then there is nothing
 * to anchor it to the line.
 */
export function stationsAlong(pads, cum, station) {
  const stated = pads.map(pad => station.get(pad) ?? null)
  const known = stated.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0)
  if (!known.length) return null
  const dir = known.length < 2 ? 1 : Math.sign(stated[known[known.length - 1]] - stated[known[0]]) || 1

  // A station has to agree with the lengths that lead to it. Where it does not
  // — a Fehlprofil, or a point stationed on something else — that one is put
  // aside and the lengths carry the chain past it. Keeping it would move
  // everything behind it to a place it is not.
  const anchors = [known[0]]
  for (const i of known.slice(1)) {
    const at = anchors[anchors.length - 1]
    const span = Math.abs(stated[i] - stated[at])
    const run = cum[i] - cum[at]
    if (Math.abs(span - run) <= 1 + 0.01 * run) anchors.push(i)
  }
  return pads.map((_, i) => {
    const a = anchors.reduce((best, k) => (Math.abs(k - i) < Math.abs(best - i) ? k : best), anchors[0])
    return a === i ? stated[i] : stated[a] + dir * (cum[i] - cum[a])
  })
}

/**
 * Height of every point of a chain, in chain order, in the chain's own height
 * system. A missing one is carried over from its neighbour along the gradient
 * the elements state — checked against the files, the stated heights and the
 * gradient agree to a tenth of a millimetre.
 */
function heightsAlong(pads, chain, height, sys) {
  const out = pads.map(pad => height.get(padKey(pad, sys)) ?? null)
  if (out.every(v => v == null)) return null
  // Rise over an element: its gradient, and the average of both where it is
  // the rounding between two.
  const rise = chain.map(el => (el.p2 + el.p3) / 2 * el.p1 / 1000)
  for (let i = 1; i < out.length; i++) {
    if (out[i] == null && out[i - 1] != null) out[i] = out[i - 1] + rise[i - 1]
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i] == null && out[i + 1] != null) out[i] = out[i + 1] - rise[i]
  }
  return out.every(v => v != null) ? out : null
}

/**
 * The tangent points of one chain, in absolute station. Null where nothing
 * anchors it — no point stationed, or no height anywhere along it.
 */
function verticesOf(chain, station, height, sys) {
  const pads = [chain[0].pad1, ...chain.map(el => el.pad2)]
  const cum = [0]
  for (const el of chain) cum.push(cum[cum.length - 1] + (el.p1 ?? 0))
  const at = stationsAlong(pads, cum, station)
  const z = heightsAlong(pads, chain, height, sys)
  if (!at || !z) return null

  const points = [{ station: at[0], z: z[0] }]
  for (let i = 0; i < chain.length; i++) {
    const el = chain[i]
    // A slope: its ends are tangent points, and the one it shares with the
    // next element is a vertex only where no rounding follows.
    if (el.p2 === el.p3) {
      const next = chain[i + 1]
      if (next && next.p2 === next.p3) points.push({ station: at[i + 1], z: z[i + 1] })
      continue
    }
    // A rounding: one vertex where the two slopes meet, at its middle.
    const half = (at[i + 1] - at[i]) / 2
    points.push({
      station: at[i] + half,
      z: z[i] + el.p2 * half / 1000,
      rv: Math.abs(1000 * el.p1 / (el.p3 - el.p2)),
    })
  }
  points.push({ station: at[at.length - 1], z: z[z.length - 1] })
  return points[0].station <= points[points.length - 1].station ? points : points.reverse()
}

/**
 * Every gradient the file states, as `{ line, sys, from, to, points }` with
 * `points` the tangent polygon in absolute station, ascending.
 *
 * Chains are built per height system: two systems over the same stretch are
 * two readings of the same gradient, not one chain with a step in it.
 */
export function mdbGradientChains(payload) {
  const { station, line } = stationIndex(payload)
  const height = new Map()
  for (const h of payload?.heights ?? []) {
    if (Number.isFinite(h?.h)) height.set(padKey(h?.pad, h?.sys), h.h)
  }
  const bySys = new Map()
  for (const el of payload?.gradients ?? []) {
    if (!el?.pad1 || !el?.pad2 || !Number.isFinite(el?.p1)) continue
    if (!bySys.has(el.sys)) bySys.set(el.sys, [])
    bySys.get(el.sys).push(el)
  }
  const out = []
  let refused = 0
  for (const [sys, elements] of bySys) {
    for (const chain of chainsOf(elements)) {
      const points = verticesOf(chain, station, height, sys)
      if (!points) { refused += 1; continue }
      const pads = [chain[0].pad1, ...chain.map(el => el.pad2)]
      out.push({
        // The line is what both chains are stated along, and the
        // Betriebsstellen are what keeps two of them apart: the field holds a
        // line number on the open line but a track number inside a station,
        // and every station has a track 5.
        line: pads.map(pad => line.get(pad)).find(Boolean) ?? '',
        bst: new Set(pads.map(bstOf)),
        sys,
        from: points[0].station,
        to: points[points.length - 1].station,
        points,
      })
    }
  }
  return { chains: out, refused }
}

/** Height on the tangent polygon at an absolute station. */
function zAt(points, s) {
  if (s <= points[0].station) return points[0].z
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (s <= b.station) {
      const t = b.station === a.station ? 0 : (s - a.station) / (b.station - a.station)
      return a.z + (b.z - a.z) * t
    }
  }
  return points[points.length - 1].z
}

/**
 * The piece of gradient a track runs over, as `track.heights`: stations along
 * the track from its BEGIN, the first at 0 and the last at its length.
 *
 * `begin` and `end` are the absolute stations of the track's two ends — their
 * order says which way the track runs against the stationing, and the heights
 * are turned around with it. Null where no chain of the same line reaches over
 * the whole track: a gradient that covers half of it would be read as a track
 * that is level where it is simply not stated.
 *
 * `bst` is the set of Betriebsstellen the track's own chain touches; a
 * gradient counts as the same stretch only where the two meet in one.
 *
 * `length` is the track's own length, and both its ends are anchors: the
 * stationing of a line and the lengths of the elements laid along it are two
 * measurements of the same stretch and disagree by a few centimetres per
 * kilometre (Fehlprofile, and a gradient stated over the line's axis rather
 * than this track's). Stretching the piece over the track's length spreads
 * that out instead of piling it up at the far end, and leaves the last height
 * point exactly where the model wants it — at the track's length.
 */
export function gradientForTrack(chains, { line, bst, begin, end, length }) {
  if (!Number.isFinite(begin) || !Number.isFinite(end) || !(length > 0)) return null
  const lo = Math.min(begin, end)
  const hi = Math.max(begin, end)
  const chain = chains.find(c => c.line === line
    && [...bst].some(b => c.bst.has(b))
    && c.from <= lo + REACH_TOL && c.to >= hi - REACH_TOL)
  if (!chain) return null

  const span = Math.abs(end - begin)
  // The stretch the stationing says the track covers has to be the stretch it
  // is. A per cent of stretching is the stationing and the geometry measuring
  // the same line a little differently; more than that and the two are not
  // talking about the same piece of track, and the gradient would be hung
  // somewhere along it at random.
  if (!(span > 0) || Math.abs(span - length) > 1 + 0.01 * length) return null
  const along = (s) => Math.abs(s - begin) * length / span
  const inside = chain.points.filter(p => p.station > lo + SAME && p.station < hi - SAME)
  return [
    { station: along(begin), z: zAt(chain.points, begin) },
    ...inside.map(p => ({ station: along(p.station), z: p.z, ...(p.rv ? { rv: p.rv } : {}) })),
    { station: along(end), z: zAt(chain.points, end) },
  ].sort((a, b) => a.station - b.station)
}
