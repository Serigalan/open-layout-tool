"""An alignment from measured axis points — phase 12, stage B (AP 12.5).

The points come in travel order, as the point file of stage A has them
(Entscheidung 138): easting and northing in one plane. What goes back is a
chain of straights, arcs and transitions in the app's element form, and what
the user needs to judge and correct it:

1. The **curvature diagram** κ(s) from mid-ordinates on a chord (κ = 8f/c²),
   smoothed — a straight is κ ≈ 0, an arc a plateau, a transition a ramp.
   Signed like the radius: > 0 for a right-hand curve.
2. **Straights**, by the client's procedure: a window of 6 m from the start;
   if every point in it lies within 1 cm of its best-fit line, it is a
   candidate, else the window moves 0.5 m on. A candidate is extended in steps
   while the deviation stays within 1 cm. It counts if the circle through it
   has a mid-ordinate under 3 mm over its length — without that, every curve
   wider than R 450 would be found as a row of short straights — and if it is
   at least 20 m long. The search goes on 6 m behind it. Every number is a
   setting. A straight can also be given by hand (`straights`), which skips
   the search.
3. **Curves between two straights:** the splice construction
   (geometry.fit_curve_group, what splice.py builds an arc in a corner with),
   its R, L1 and L2 adjusted to the points between by least squares
   (Nelder-Mead). A transition the points do not show — the fit without it is
   as good — is left out (L = 0).
4. **The ends**, where the points start or stop inside a curve: transition and
   arc from the tangent point on the straight, its place, R and L adjusted
   likewise, cut where the points stop; where an exit transition shows in the
   points, it is fitted too.
5. **Report:** the offset of every point from the chain and, per element, the
   largest and the RMS.

Conventions are the geometry kernel's: bearings in degrees clockwise from grid
north, signed radius > 0 for a right-hand curve. Lengths in metres.
"""

import math

import numpy as np
from scipy.optimize import minimize
from scipy.spatial import cKDTree

from .geometry import RAD2DEG, _arc_forward, fit_curve_group, sample_transition, transition_end
from .splice import arc as arc_element, straight as straight_element, transition as transition_element

DEFAULTS = {
    "window": 6.0,        # first window of a straight [m]
    "tolerance": 0.01,    # largest deviation of a point from a straight's line [m]
    "step": 0.5,          # how far the window moves, and a straight grows, per try [m]
    "spacing": 6.0,       # gap behind a straight before the next is looked for [m]
    "sagitta": 0.003,     # largest mid-ordinate of the circle through a straight [m]
    "minLength": 20.0,    # shortest straight [m]
    "chord": 10.0,        # chord of the curvature diagram [m]
}
LIMITS = {
    "window": (1.0, 100.0), "tolerance": (0.001, 0.2), "step": (0.1, 10.0), "spacing": (0.0, 100.0),
    "sagitta": (0.0005, 0.1), "minLength": (2.0, 1000.0), "chord": (2.0, 50.0),
}

MAX_POINTS = 40000
# Consecutive points further apart than this many times their usual spacing (at
# least GAP_MIN metres) are a gap in the measured axis: a switch, a level
# crossing, something in the way.
GAP_FACTOR = 5.0
GAP_MIN = 2.0
# The curvature is smoothed by a running mean over this length [m].
KAPPA_SMOOTH = 5.0
# Points of a straight a curve fit takes along on either side, up to half the
# straight: a detected straight runs a little into the transitions it ends in,
# and these points say where the curve really starts.
CURVE_MARGIN = 30.0
# A transition is left out when the fit without it is worse by less than this
# in the RMS [m] — then it is not in the points.
TRANSITION_EVIDENCE = 0.0005
# … which is only tried for a transition that shifts its arc inwards by less
# than this [m]: a larger shift the points cannot miss.
TRANSITION_TEST_SHIFT = 0.02
# An exit transition at an open end is kept only if it improves the RMS by
# this factor.
EDGE_EXIT_GAIN = 0.7
# … and only tried where the arc alone leaves the points this many times
# further off than they scatter about the straights.
EDGE_EXIT_NOISE = 1.5
R_MIN = 20.0
# Nelder-Mead stops where the sum of squares [m²] changes by less than this:
# a few hundred points a millimetre off sum to some 1e-4.
FATOL = 1e-8
SAMPLE_STEP = 1.0          # metres between the points a fitted chain is drawn with
SAMPLE_SAGITTA = 0.0002    # … or closer, where a tight arc needs it
STRAIGHT_STEP = 5.0        # … and on a straight
NEAR_VERTICES = 3          # vertices whose segments a point is measured against


class AlignError(Exception):
    """A fit that cannot be made, `code` being the key the app translates."""

    def __init__(self, code, **params):
        super().__init__(code)
        self.code = code
        self.params = params


def _bearing_of(d):
    return (math.atan2(d[0], d[1]) * RAD2DEG) % 360.0


def _dir(bearing):
    b = math.radians(bearing)
    return np.array([math.sin(b), math.cos(b)])


# ── the points ───────────────────────────────────────────────────────────────

def stations_of(pts, station0=0.0):
    seg = np.hypot(*np.diff(pts, axis=0).T)
    return station0 + np.concatenate([[0.0], np.cumsum(seg)]), seg


def find_gaps(seg):
    """Indices i where the axis has a gap between point i and i + 1."""
    if not len(seg):
        return []
    limit = max(GAP_MIN, GAP_FACTOR * float(np.median(seg)))
    return [int(i) for i in np.nonzero(seg > limit)[0]]


def curvature(pts, s, gaps, chord):
    """κ at every point from the mid-ordinate on a chord centred on it; NaN
    where the chord leaves the points or spans a gap. Then a running mean."""
    half = chord / 2
    n = len(s)
    k = np.full(n, np.nan)
    lo, hi = s - half, s + half
    ok = (lo >= s[0]) & (hi <= s[-1])
    for g in gaps:
        ok &= ~((lo < s[g + 1]) & (hi > s[g]))
    ax, ay = np.interp(lo, s, pts[:, 0]), np.interp(lo, s, pts[:, 1])
    bx, by = np.interp(hi, s, pts[:, 0]), np.interp(hi, s, pts[:, 1])
    cx, cy = bx - ax, by - ay
    c2 = cx * cx + cy * cy
    with np.errstate(invalid="ignore", divide="ignore"):
        # Left of the chord is the outside of a right-hand curve: κ > 0.
        f = (cx * (pts[:, 1] - ay) - cy * (pts[:, 0] - ax)) / np.sqrt(c2)
        k[ok] = (8 * f / c2)[ok]
    return smooth(k, s, KAPPA_SMOOTH)


def smooth(values, s, length):
    """Running mean over `length` metres, NaNs left out of it."""
    good = np.isfinite(values)
    v = np.where(good, values, 0.0)
    cs = np.concatenate([[0.0], np.cumsum(v)])
    cn = np.concatenate([[0], np.cumsum(good)])
    lo = np.searchsorted(s, s - length / 2, side="left")
    hi = np.searchsorted(s, s + length / 2, side="right")
    cnt = cn[hi] - cn[lo]
    out = np.full(len(values), np.nan)
    m = good & (cnt > 0)
    out[m] = (cs[hi] - cs[lo])[m] / cnt[m]
    return out


# ── straights ────────────────────────────────────────────────────────────────

def fit_line(p):
    """Best-fit line (total least squares) through `p`: centre, unit direction
    along the points' order, and the largest perpendicular deviation."""
    c = p.mean(axis=0)
    q = p - c
    _, vecs = np.linalg.eigh(q.T @ q)
    d = vecs[:, 1]
    if d @ (p[-1] - p[0]) < 0:
        d = -d
    dev = q[:, 0] * d[1] - q[:, 1] * d[0]
    return c, d, float(np.abs(dev).max()) if len(dev) else 0.0


def line_sagitta(p, c, d):
    """Mid-ordinate over its length of the parabola (≈ circle) through `p`, in
    the frame of its line."""
    q = p - c
    x = q @ d
    y = q[:, 0] * d[1] - q[:, 1] * d[0]
    span = float(x.max() - x.min())
    if len(p) < 4 or span <= 0:
        return 0.0
    a = np.linalg.lstsq(np.stack([x * x, x, np.ones_like(x)], axis=1), y, rcond=None)[0][0]
    return abs(a) * span * span / 4


def _spans_gap(i, j, gaps):
    return any(i <= g < j for g in gaps)


class _Lines:
    """Best-fit lines over ranges of the points, from running sums: the
    search tries thousands of ranges, and a range's line is then two
    subtractions and an angle instead of a decomposition."""

    def __init__(self, pts):
        x, y = pts[:, 0], pts[:, 1]
        self.pts = pts
        self.sums = [np.concatenate([[0.0], np.cumsum(v)]) for v in (x, y, x * x, x * y, y * y)]

    def deviation(self, i, j):
        """Largest distance of points i…j from their best-fit line."""
        n = j - i + 1
        sx, sy, sxx, sxy, syy = (c[j + 1] - c[i] for c in self.sums)
        mx, my = sx / n, sy / n
        cxx, cxy, cyy = sxx / n - mx * mx, sxy / n - mx * my, syy / n - my * my
        theta = 0.5 * math.atan2(2 * cxy, cxx - cyy)
        q = self.pts[i:j + 1]
        return float(np.abs((q[:, 0] - mx) * math.sin(theta) - (q[:, 1] - my) * math.cos(theta)).max())


def find_straights(pts, s, gaps, o):
    """The client's procedure (module docstring, step 2): [(i, j)] point ranges."""
    n = len(s)
    lines = _Lines(pts)
    found = []
    i = 0
    while i < n - 2:
        j = int(np.searchsorted(s, s[i] + o["window"], side="left"))
        if j >= n:
            break
        if _spans_gap(i, j, gaps):
            i = next(g + 1 for g in gaps if i <= g < j)
            continue
        if lines.deviation(i, j) > o["tolerance"]:
            i = int(np.searchsorted(s, s[i] + o["step"], side="left"))
            continue
        # Grow it while the deviation holds.
        while True:
            k = int(np.searchsorted(s, s[j] + o["step"], side="left"))
            if k >= n or _spans_gap(j, k, gaps) or lines.deviation(i, k) > o["tolerance"]:
                break
            j = k
        c, d, _ = fit_line(pts[i:j + 1])
        if s[j] - s[i] >= o["minLength"] and line_sagitta(pts[i:j + 1], c, d) < o["sagitta"]:
            found.append((i, j))
            i = int(np.searchsorted(s, s[j] + o["spacing"], side="left"))
        else:
            i = int(np.searchsorted(s, s[i] + o["step"], side="left"))
    return found


def given_straights(s, ranges):
    """Straights set by hand, as station ranges: point ranges, in order, each
    with at least three points, overlaps merged."""
    out = []
    for frm, to in sorted((min(a, b), max(a, b)) for a, b in ranges):
        i = int(np.searchsorted(s, frm, side="left"))
        j = int(np.searchsorted(s, to, side="right")) - 1
        if j - i < 2:
            continue
        if out and i <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], j))
        else:
            out.append((i, j))
    return out


# ── chains ───────────────────────────────────────────────────────────────────
#
# A piece is one element in the making: where it starts, its bearing there,
# its length and curvature. Pieces are drawn as points for the distances and
# turned into the app's elements at the end.

def piece_end(pc):
    p, b, length = pc["start"], pc["bearing"], pc["length"]
    if pc["kind"] == "straight":
        d = _dir(b)
        return (p[0] + length * d[0], p[1] + length * d[1]), b
    if pc["kind"] == "arc":
        return _arc_forward(p[0], p[1], b, pc["r"], length / abs(pc["r"]))
    e, n, eb = transition_end(p[0], p[1], b, length, pc["r1"], pc["r2"], "clothoid")
    return (e, n), eb


def piece_points(pc):
    p, b, length = pc["start"], pc["bearing"], pc["length"]
    if length <= 0:
        return np.array([p])
    if pc["kind"] == "straight":
        d = _dir(b)
        t = np.linspace(0.0, length, max(2, int(math.ceil(length / STRAIGHT_STEP)) + 1))
        return np.stack([p[0] + t * d[0], p[1] + t * d[1]], axis=1)
    radii = [abs(r) for r in (pc.get("r"), pc.get("r1"), pc.get("r2")) if r]
    step = min(SAMPLE_STEP, math.sqrt(8 * SAMPLE_SAGITTA * min(radii)))
    steps = max(2, int(math.ceil(length / step)))
    if pc["kind"] == "arc":
        r = pc["r"]
        side = 1.0 if r > 0 else -1.0
        d = _dir(b)
        ar = abs(r)
        cx, cy = p[0] + ar * side * d[1], p[1] - ar * side * d[0]
        ang = -side * np.linspace(0.0, length / ar, steps + 1)
        rx, ry = p[0] - cx, p[1] - cy
        return np.stack([cx + rx * np.cos(ang) - ry * np.sin(ang), cy + rx * np.sin(ang) + ry * np.cos(ang)], axis=1)
    return np.array(sample_transition(p[0], p[1], b, length, pc["r1"], pc["r2"], "clothoid", steps))


def chain_from(start, bearing, specs):
    """Pieces one after the other from `start`: specs are (kind, length, r | (r1, r2))."""
    out = []
    p, b = start, bearing
    for kind, length, r in specs:
        if length <= 1e-9:
            continue
        pc = {"kind": kind, "start": p, "bearing": b, "length": length}
        if kind == "arc":
            pc["r"] = r
        elif kind == "transition":
            pc["r1"], pc["r2"] = r
        out.append(pc)
        p, b = piece_end(pc)
    return out


def chain_points(pieces):
    """The chain as a polyline, and for every vertex the piece it belongs to
    and the station along the chain."""
    pts, owner = [], []
    for k, pc in enumerate(pieces):
        q = piece_points(pc)
        if pts:
            q = q[1:]
        pts.append(q)
        owner.append(np.full(len(q), k))
    if not pts:
        return np.zeros((0, 2)), np.zeros(0, dtype=int)
    return np.concatenate(pts), np.concatenate(owner)


def project(points, poly):
    """Distance of every point to the polyline, signed (> 0 right of its
    direction), the segment it is nearest and where along it (0…1).

    Only the segments at the vertices nearest to a point are tried: the points
    lie millimetres from a polyline that does not fold back on itself.
    """
    m = len(poly) - 1
    _, near = cKDTree(poly).query(points, k=min(NEAR_VERTICES, len(poly)))
    near = near.reshape(len(points), -1)
    cand = np.clip(np.concatenate([near - 1, near], axis=1), 0, m - 1)       # (n, c)
    a = poly[cand]
    ab = poly[cand + 1] - a
    den = (ab * ab).sum(axis=2)
    den[den == 0] = 1.0
    ap = points[:, None, :] - a
    t = np.clip((ap * ab).sum(axis=2) / den, 0.0, 1.0)
    dv = ap - t[:, :, None] * ab
    d2 = (dv * dv).sum(axis=2)
    best = d2.argmin(axis=1)
    rows = np.arange(len(points))
    seg = cand[rows, best]
    ts = t[rows, best]
    dist = np.sqrt(d2[rows, best])
    abb, apb = ab[rows, best], ap[rows, best]
    cross = abb[:, 0] * apb[:, 1] - abb[:, 1] * apb[:, 0]
    return np.where(cross > 0, -dist, dist), seg, ts


def _segment(a, b):
    """The line from a to b with a vertex every STRAIGHT_STEP, for `project`."""
    k = max(1, int(math.ceil(float(np.hypot(*(np.asarray(b) - a))) / STRAIGHT_STEP)))
    u = np.linspace(0.0, 1.0, k + 1)[:, None]
    return np.asarray(a) + u * (np.asarray(b) - np.asarray(a))


def sse(points, poly):
    if len(points) == 0 or len(poly) < 2:
        return 0.0
    off, _, _ = project(points, poly)
    return float((off * off).sum())


def chain_station(pieces, point):
    """How far along the chain `point` projects [m]."""
    poly, _ = chain_points(pieces)
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(poly, axis=0).T))])
    _, seg, t = project(np.array([point]), poly)
    return float(along[seg[0]] + t[0] * (along[seg[0] + 1] - along[seg[0]]))


def cut_chain(pieces, point):
    """The chain up to where `point` projects onto it."""
    at = chain_station(pieces, point)
    out = []
    start = 0.0
    for pc in pieces:
        if start + pc["length"] <= at + 1e-9:
            out.append(dict(pc))
            start += pc["length"]
            continue
        into = at - start
        if into > 1e-6:
            pc = dict(pc)
            if pc["kind"] == "transition":
                # A clothoid cut short is a clothoid to the curvature it has there.
                k1 = 1.0 / pc["r1"] if pc["r1"] else 0.0
                k2 = 1.0 / pc["r2"] if pc["r2"] else 0.0
                kc = k1 + (k2 - k1) * into / pc["length"]
                pc["r2"] = 1.0 / kc if abs(kc) > 1e-12 else None
            pc["length"] = into
            out.append(pc)
        break
    return out


def piece_element(pc):
    """The app's element for a piece (splice.py's form, without a role)."""
    end, end_b = piece_end(pc)
    p = pc["start"]
    if pc["kind"] == "straight":
        el = straight_element(p, end, None)
    elif pc["kind"] == "arc":
        el = arc_element(p, end, pc["r"], None)
        el["length"] = pc["length"]
    else:
        el = transition_element(p, pc["bearing"], pc["length"], pc["r1"], pc["r2"], "clothoid",
                                None, end=end, end_bearing=end_b)
    el.pop("role", None)
    el["startNode"] = [float(el["startNode"][0]), float(el["startNode"][1])]
    el["endNode"] = [float(el["endNode"][0]), float(el["endNode"][1])]
    return el


# ── a curve between two straights ────────────────────────────────────────────

def corner_pieces(fit, l1, l2):
    sr = fit["signed_r"]
    b0 = fit["b_in"]
    return chain_from(tuple(fit["cl_start"]), b0, [
        ("transition", l1, (None, sr)),
        ("arc", fit["arc_len"], sr),
        ("transition", l2, (sr, None)),
    ])


def shift(length, r):
    """How far a clothoid of `length` moves an arc of `r` inwards (L²/24R) [m]."""
    return length * length / (24 * abs(r)) if r else 0.0


def _corner(line_a, line_b, p_from, p_to, r, l1, l2):
    fit = fit_curve_group(tuple(p_from), tuple(line_a[1]), tuple(p_to), tuple(line_b[1]), r, l1, l2)
    if fit is None or fit["entry_len"] < 0 or fit["exit_len"] < 0:
        return None
    fit["b_in"] = _bearing_of(line_a[1])
    return fit


def _start_values(kappa, s, frm, to):
    """A first guess from κ between two stations: R from its plateau, L1 and
    L2 from the ramps up to it and down again, and the stations where κ
    passes half the plateau on the way up (`rise`) and down (`fall`) — the
    middle of each transition. A ramp the stretch does not show is None.
    Returns None where κ has no plateau."""
    m = (s >= frm) & (s <= to) & np.isfinite(kappa)
    k = kappa[m]
    if len(k) < 3:
        return None
    a = np.abs(k)
    top = a.max()
    plateau = float(np.median(a[a >= 0.7 * top])) if top > 0 else 0.0
    if plateau <= 1e-7:
        return None
    ss = s[m]
    rise = np.nonzero(a >= 0.2 * plateau)[0]
    full = np.nonzero(a >= 0.8 * plateau)[0]
    half = np.nonzero(a >= 0.5 * plateau)[0]
    return {
        "r": 1.0 / plateau, "sign": 1.0 if k.mean() >= 0 else -1.0,
        "l1": max(0.0, (ss[full[0]] - ss[rise[0]]) / 0.6 - 5.0),
        "l2": max(0.0, (ss[rise[-1]] - ss[full[-1]]) / 0.6 - 5.0),
        "rise": float(ss[half[0]]) if half[0] > 0 else None,
        "fall": float(ss[half[-1]]) if half[-1] < len(a) - 1 else None,
    }


def fit_corner(pts_fit, line_a, line_b, p_from, p_to, guess, extent):
    """R, L1, L2 of the curve between two lines adjusted to `pts_fit` by least squares.

    `extent` is the stretch of line on either side the points are measured
    against besides the curve: (a point on line a before it, one on line b
    after it). Returns (fit, l1, l2, rms) or None.
    """
    a_far, b_far = extent

    def build(r, l1, l2):
        fit = _corner(line_a, line_b, p_from, p_to, r, l1, l2)
        if fit is None:
            return None, None
        pieces = corner_pieces(fit, l1, l2)
        poly, _ = chain_points(pieces)
        poly = np.concatenate([_segment(a_far, poly[0])[:-1], poly, _segment(poly[-1], b_far)[1:]])
        return fit, poly

    def cost(x, fixed):
        r = abs(x[0])
        ls = [abs(v) for v in x[1:]]
        l1 = 0.0 if fixed[0] else ls[0]
        l2 = 0.0 if fixed[1] else ls[-1]
        if r < R_MIN:
            return 1e12
        _, poly = build(r, l1, l2)
        if poly is None:
            return 1e12
        return sse(pts_fit, poly)

    def run(r0, l1, l2, fixed):
        x0 = [r0] + [v for v, f in zip((l1, l2), fixed) if not f]
        simplex = [x0]
        for i in range(len(x0)):
            x = list(x0)
            x[i] += max(0.1 * r0, 5.0) if i == 0 else 10.0
            simplex.append(x)
        res = minimize(cost, x0, args=(fixed,), method="Nelder-Mead",
                       options={"initial_simplex": simplex, "xatol": 0.01, "fatol": FATOL, "maxiter": 800})
        x = res.x
        it = iter(abs(v) for v in x[1:])
        l1v = 0.0 if fixed[0] else next(it)
        l2v = 0.0 if fixed[1] else next(it)
        return abs(x[0]), l1v, l2v, res.fun

    r0, l1, l2 = guess
    # A start the construction cannot build is no start: shorten the ramps,
    # then widen the curve, until it can.
    for _ in range(40):
        if build(r0, l1, l2)[0] is not None:
            break
        if l1 + l2 > 1:
            l1, l2 = l1 / 2, l2 / 2
        else:
            l1 = l2 = 0.0
            r0 *= 0.8
    else:
        return None
    full = run(r0, l1, l2, (False, False))
    n = max(1, len(pts_fit))
    best = full
    # A transition the points do not show is not there: the simplest fit that
    # is as good as the full one wins. Only a transition that shifts the arc by
    # little can be one the points do not show.
    weak = [shift(full[i + 1], full[0]) < TRANSITION_TEST_SHIFT for i in range(2)]
    tries = [f for f in ((True, True), (True, False), (False, True)) if all(w or not z for w, z in zip(weak, f))]
    for fixed in tries:
        cand = run(full[0], full[1], full[2], fixed)
        if math.sqrt(cand[3] / n) <= math.sqrt(full[3] / n) + TRANSITION_EVIDENCE:
            best = cand
            break
    r, l1, l2, f = best
    fit, _ = build(r, l1, l2)
    if fit is None:
        return None
    return fit, l1, l2, math.sqrt(f / n)


# ── an open end: a curve the points stop in ──────────────────────────────────

def fit_edge(pts_fit, line, base, guess, last_point, t_min, noise):
    """A curve after a straight that the points stop inside.

    From the tangent point T = base + t·d on the straight: a transition L1, an
    arc R and — if the points show it — an exit transition L2 and the straight
    beyond, cut where `last_point` projects. `guess` is the first guess in the
    edge's own direction: r, sign, l1, l2, t and the arc length `arc`, None
    where κ does not come down again. `t_min` keeps T behind whatever the
    chain has before it; `noise` is the scatter of the points about the
    straights [m]. Returns (pieces, info) or None.
    """
    d = line[1]
    b0 = _bearing_of(d)
    sign = guess["sign"]
    reach = max(10.0, float(np.hypot(*(last_point - base))) + 20.0)

    def pieces_for(t, r, l1, arc=None, l2=0.0):
        tp = (base[0] + t * d[0], base[1] + t * d[1])
        sr = sign * r
        if arc is None:
            arc = min(reach, 0.9 * math.pi * r)
        specs = [("transition", l1, (None, sr)), ("arc", arc, sr)]
        if l2 > 0:
            specs += [("transition", l2, (sr, None)), ("straight", reach, None)]
        return chain_from(tp, b0, specs), tp

    back = min(0.0, float((pts_fit[0] - base) @ d)) - 1.0

    def cost(x):
        t, r = x[0], abs(x[1])
        if r < R_MIN:
            return 1e12
        pieces, _ = pieces_for(t, r, *([abs(v) for v in x[2:]] or [0.0]))
        poly, _ = chain_points(pieces)
        poly = np.concatenate([_segment(base + min(t, back) * d, poly[0])[:-1], poly])
        return sse(pts_fit, poly) + 1e6 * max(0.0, t_min - t) ** 2

    def nm(x0):
        steps = [5.0, max(0.1 * x0[1], 5.0)] + [10.0] * (len(x0) - 2)
        simplex = [list(x0)] + [[v + (steps[i] if i == j else 0.0) for j, v in enumerate(x0)] for i in range(len(x0))]
        res = minimize(cost, x0, method="Nelder-Mead",
                       options={"initial_simplex": simplex, "xatol": 0.01, "fatol": FATOL, "maxiter": 1500})
        return [res.x[0]] + [abs(v) for v in res.x[1:]], res.fun

    n = max(1, len(pts_fit))
    t0 = max(t_min, guess["t"])
    # The arc runs on to the end of the points…
    x, f = nm([t0, guess["r"], guess["l1"]])
    # … with no transition before it, if the points do not show one …
    if shift(x[2], x[1]) < TRANSITION_TEST_SHIFT:
        x0, f0 = nm([x[0] + x[2] / 2, x[1]])
        if math.sqrt(f0 / n) <= math.sqrt(f / n) + TRANSITION_EVIDENCE:
            x, f = x0 + [0.0], f0
    model = x + [None, 0.0]
    # … or leaves it again before they stop: an exit transition and the
    # straight beyond, where κ comes down or the arc alone leaves the points
    # clearly worse off than the straights do, and it fits clearly better.
    if guess["arc"] is not None or math.sqrt(f / n) > EDGE_EXIT_NOISE * noise:
        arc0 = guess["arc"]
        if arc0 is None:
            arc0 = max(1.0, chain_station(pieces_for(*x)[0], last_point) - x[2] - 20.0)
        x5, f5 = nm([t0, guess["r"], guess["l1"], max(1.0, arc0), max(guess["l2"], 10.0)])
        if f5 < EDGE_EXIT_GAIN ** 2 * f:
            model, f = x5, f5
    t, r, l1, arc, l2 = model
    pieces, tp = pieces_for(t, r, l1, arc, l2)
    pieces = cut_chain(pieces, last_point)
    return pieces, {"tangent": tp, "radius": sign * r, "l1": l1, "l2": l2, "rms": math.sqrt(f / n), "t": t}


# ── the whole fit ────────────────────────────────────────────────────────────

def _line_through(pts):
    c, d, _ = fit_line(pts)
    return (c, d)


def _scatter(p, line):
    c, d = line
    q = p - c
    dev = q[:, 0] * d[1] - q[:, 1] * d[0]
    return math.sqrt(float((dev * dev).mean()))


def _foot(line, p):
    c, d = line
    return c + ((p - c) @ d) * d


def _notes_for(kappa, s, frm, to, radius, k_noise):
    """What the curvature along a fitted arc (stations `frm` to `to`) says about
    it: a reverse or a compound curve, which one arc cannot follow — Korb- and
    Gegenbögen without a straight between are later work, until then they are
    named. Read in thirds of the arc, against the arc's own curvature and the
    scatter `k_noise` κ has on the straights; where κ is blurred by the chord
    and the smoothing, the caller has already cut it off."""
    if to - frm < 15:
        return []
    plateau = 1 / radius
    edges = np.linspace(frm, to, 4)
    means = []
    for a, b in zip(edges[:-1], edges[1:]):
        k = kappa[(s >= a) & (s <= b) & np.isfinite(kappa)]
        if len(k) < 3:
            return []
        means.append(float(k.mean()) * math.copysign(1.0, radius))
    floor = 3 * k_noise
    if min(means) < -max(0.3 * plateau, floor):
        return ["reverse"]
    if max(means) - min(means) > max(0.25 * plateau, floor):
        return ["compound"]
    return []


class _Chain:
    """The chain in the making, in travel order, and the curves in it."""

    def __init__(self):
        self.pieces = []
        self.curves = []
        self.overlap = None

    def straight(self, frm, to, d):
        """The straight from `frm` to `to` on a line of direction `d`. One
        that runs backwards is a straight the curves on either side have eaten
        up — a millimetre of that is rounding."""
        length = float((to - frm) @ d)
        if length < -0.001 and self.overlap is None:
            self.overlap = (frm, length)
        if length > 1e-6:
            self.pieces.append({"kind": "straight", "start": (float(frm[0]), float(frm[1])),
                                "bearing": _bearing_of(d), "length": length})

    def curve(self, kind, pieces, radius, l1, l2):
        first = len(self.pieces)
        self.pieces.extend(pc for pc in pieces if pc["length"] > 1e-6)
        self.curves.append({"kind": kind, "elements": [first, len(self.pieces) - 1],
                            "radius": radius, "l1": l1, "l2": l2})


class _NoFit(Exception):
    """No curve fits a stretch; `pair` is the straight before it, where the
    stretch lies between two."""

    def __init__(self, code, frm, to, pair=None):
        super().__init__(code)
        self.code, self.frm, self.to, self.pair = code, frm, to, pair


def _edge_guess(g, at, way):
    """`_start_values` turned into fit_edge's guess for an edge leaving the
    straight at station `at` forwards (`way` 1) or backwards (-1)."""
    if way > 0:
        l1, l2, rise, fall = g["l1"], g["l2"], g["rise"], g["fall"]
        t = (rise - l1 / 2 - at) if rise is not None else 0.0
    else:
        l1, l2, rise, fall = g["l2"], g["l1"], g["fall"], g["rise"]
        t = (at - rise - l1 / 2) if rise is not None else 0.0
    arc = abs(fall - rise) - (l1 + l2) / 2 if rise is not None and fall is not None else None
    return {"r": g["r"], "sign": g["sign"] * way, "l1": l1, "l2": l2, "t": t,
            "arc": max(1.0, arc) if arc is not None else None}


def _assemble(pts, s, kappa, ranges, o):
    """The chain through the straights `ranges` (point index ranges), the
    curves between them and at the ends fitted. Raises _NoFit."""
    lines = [_line_through(pts[i:j + 1]) for i, j in ranges]
    # How far the points scatter about a line: what a fit cannot do better than.
    noise = float(np.median([_scatter(pts[i:j + 1], line) for (i, j), line in zip(ranges, lines)]))
    chain = _Chain()
    n = len(pts)

    def off_line(p, line):
        c, d = line
        return float(np.abs((p - c) @ np.array([d[1], -d[0]])).max())

    # The start: a curve the points begin in, fitted backwards from the first straight.
    i0, j0 = ranges[0]
    junction = _foot(lines[0], pts[0])
    if i0 > 0 and off_line(pts[:i0 + 1], lines[0]) > o["tolerance"]:
        c0, d0 = lines[0]
        k_hi = int(np.searchsorted(s, s[i0] + min(CURVE_MARGIN, (s[j0] - s[i0]) / 2), side="right"))
        g = _start_values(kappa, s, s[0], s[i0])
        # Run backwards: the curve turns the other way, its exit is the entry.
        edge = fit_edge(pts[:k_hi][::-1], (c0, -d0), _foot(lines[0], pts[i0]), _edge_guess(g, s[i0], -1),
                        pts[0], -(s[j0] - s[i0]) / 2, noise) if g is not None else None
        if edge is None:
            raise _NoFit("align_error_curve", s[0], s[i0])
        epieces, info = edge
        chain.curve("start", _reverse_pieces(epieces), -info["radius"], info["l2"], info["l1"])
        junction = np.array(info["tangent"])

    for k, ((i, j), line) in enumerate(zip(ranges, lines)):
        if k + 1 < len(ranges):
            (ni, nj), nline = ranges[k + 1], lines[k + 1]
            lo = int(np.searchsorted(s, s[j] - min(CURVE_MARGIN, (s[j] - s[i]) / 2), side="left"))
            hi = int(np.searchsorted(s, s[ni] + min(CURVE_MARGIN, (s[nj] - s[ni]) / 2), side="right"))
            g = _start_values(kappa, s, s[j], s[ni])
            fitted = fit_corner(pts[lo:hi], line, nline, junction, _foot(nline, pts[nj]), (g["r"], g["l1"], g["l2"]),
                                (_foot(line, pts[lo]), _foot(nline, pts[hi - 1]))) if g is not None else None
            if fitted is None:
                raise _NoFit("align_error_curve", s[j], s[ni], pair=k)
            fit, l1, l2, _ = fitted
            chain.straight(junction, np.array(fit["cl_start"]), line[1])
            chain.curve("curve", corner_pieces(fit, l1, l2), fit["signed_r"], l1, l2)
            junction = np.array(fit["cl_end"])
            continue
        # The end: a curve the points stop in, or the straight runs out.
        c, d = line
        if j < n - 1 and off_line(pts[j:], line) > o["tolerance"]:
            lo = int(np.searchsorted(s, s[j] - min(CURVE_MARGIN, (s[j] - s[i]) / 2), side="left"))
            base = _foot(line, pts[j])
            g = _start_values(kappa, s, s[j], s[-1])
            edge = fit_edge(pts[lo:], line, base, _edge_guess(g, s[j], 1), pts[-1], float((junction - base) @ d), noise) \
                if g is not None else None
            if edge is None:
                raise _NoFit("align_error_curve", s[j], s[-1])
            epieces, info = edge
            chain.straight(junction, np.array(info["tangent"]), d)
            chain.curve("end", epieces, info["radius"], info["l1"], info["l2"])
        else:
            chain.straight(junction, _foot(line, pts[-1]), d)

    if chain.overlap is not None:
        frm, length = chain.overlap
        station = s[int(np.argmin(np.hypot(*(pts - frm).T)))]
        raise _NoFit("align_error_overlap", station + length, station)
    return chain


def align(points, station0=0.0, straights=None, settings=None):
    """The fit (module docstring). `points` [[e, n], ...] in travel order;
    `straights` [[from, to], ...] stations set by hand, or None to look for
    them. Returns the answer of `POST /align`."""
    o = dict(DEFAULTS)
    for key, value in (settings or {}).items():
        if key in o and value is not None:
            lo, hi = LIMITS[key]
            o[key] = min(hi, max(lo, float(value)))
    raw = np.asarray(points, dtype=float)
    if raw.ndim != 2 or raw.shape[1] < 2 or len(raw) < 10:
        raise AlignError("align_error_few_points")
    raw = raw[:, :2]
    # Repeated points carry no direction.
    keep = np.concatenate([[True], np.hypot(*np.diff(raw, axis=0).T) > 1e-4])
    raw = raw[keep]
    origin = raw[0].copy()
    pts = raw - origin
    s, seg = stations_of(pts, station0)
    gaps = find_gaps(seg)
    kappa = curvature(pts, s, gaps, o["chord"])

    auto = straights is None
    ranges = find_straights(pts, s, gaps, o) if auto else given_straights(s, straights)
    answer = {
        "stations": [round(float(v), 3) for v in s],
        "kappa": [None if not math.isfinite(v) else round(float(v), 7) for v in kappa],
        "straights": [{"from": round(float(s[i]), 3), "to": round(float(s[j]), 3)} for i, j in ranges],
        "auto": auto,
        "gaps": [{"from": round(float(s[g]), 3), "to": round(float(s[g + 1]), 3)} for g in gaps],
        "settings": o,
        "curves": [], "elements": None, "offsets": None, "elementStats": None,
    }
    if not ranges:
        answer["error"] = "align_error_no_straight"
        return answer

    def fail(code, frm, to):
        answer["error"] = code
        answer["errorParams"] = {"from": round(float(frm), 1), "to": round(float(to), 1)}
        return answer

    # Two straights no curve fits between — offset rather than turned, or
    # turned the other way than they are offset — are one straight the points
    # stray from (a shift in the measured axis); found automatically, they are
    # taken as one and the merge is named. Set by hand, they are the user's.
    merged = []
    while True:
        try:
            chain = _assemble(pts, s, kappa, ranges, o)
            break
        except _NoFit as exc:
            if not auto or exc.pair is None:
                return fail(exc.code, exc.frm, exc.to)
            k = exc.pair
            merged.append(round(float(s[ranges[k][1]]), 3))
            ranges = ranges[:k] + [(ranges[k][0], ranges[k + 1][1])] + ranges[k + 2:]
    answer["straights"] = [{"from": round(float(s[i]), 3), "to": round(float(s[j]), 3)} for i, j in ranges]
    answer["merged"] = merged
    report(answer, chain.pieces, pts, s, o, origin)

    # Where every element starts, on the stations of the points.
    starts = s[0] + np.concatenate([[0.0], np.cumsum([pc["length"] for pc in chain.pieces])])
    blur = o["chord"] / 2 + KAPPA_SMOOTH / 2
    on_straights = np.zeros(len(s), dtype=bool)
    for i, j in ranges:
        on_straights |= (s >= s[i] + blur) & (s <= s[j] - blur)
    k_straight = kappa[on_straights & np.isfinite(kappa)]
    k_noise = float(k_straight.std()) if len(k_straight) > 10 else 0.0
    for cv in chain.curves:
        a, b = cv["elements"]
        cv["from"], cv["to"] = round(float(starts[a]), 3), round(float(starts[b + 1]), 3)
        arcs = [q for q in range(a, b + 1) if chain.pieces[q]["kind"] == "arc"]
        cv["notes"] = _notes_for(kappa, s, starts[arcs[0]] + blur, starts[arcs[0] + 1] - blur,
                                 cv["radius"], k_noise) if arcs else []
        for key in ("radius", "l1", "l2"):
            cv[key] = round(float(cv[key]), 2)
    answer["curves"] = chain.curves
    answer["elementStations"] = [round(float(v), 3) for v in starts]
    return answer


def _reverse_pieces(pieces):
    """Pieces built backwards, the right way round."""
    out = []
    for pc in reversed(pieces):
        end, end_b = piece_end(pc)
        rev = {"kind": pc["kind"], "start": end, "bearing": (end_b + 180.0) % 360.0, "length": pc["length"]}
        if pc["kind"] == "arc":
            rev["r"] = -pc["r"]
        elif pc["kind"] == "transition":
            rev["r1"] = -pc["r2"] if pc["r2"] else None
            rev["r2"] = -pc["r1"] if pc["r1"] else None
        out.append(rev)
    return out


def report(answer, pieces, pts, s, o, origin):
    """Elements in the plane, every point's offset from them, per element the
    largest offset and the RMS."""
    elements = []
    for pc in pieces:
        el = piece_element({**pc, "start": (pc["start"][0] + origin[0], pc["start"][1] + origin[1])})
        elements.append(el)
    poly, owner = chain_points(pieces)
    offsets = np.zeros(len(pts))
    which = np.zeros(len(pts), dtype=int)
    # In blocks along the chain, so no block measures every point against every vertex.
    chain_s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(poly, axis=0).T))])
    rel = s - s[0]
    block = 400
    for a in range(0, len(pts), block):
        b = min(len(pts), a + block)
        lo = max(0, int(np.searchsorted(chain_s, rel[a] - 50.0)) - 1)
        hi = min(len(poly), int(np.searchsorted(chain_s, rel[b - 1] + 50.0)) + 2)
        off, seg, _ = project(pts[a:b], poly[lo:hi])
        offsets[a:b] = off
        which[a:b] = owner[np.minimum(lo + seg + 1, len(owner) - 1)]
    stats = []
    for k in range(len(pieces)):
        m = which == k
        v = offsets[m]
        stats.append({
            "n": int(m.sum()),
            "max": round(float(np.abs(v).max()), 4) if len(v) else None,
            "rms": round(float(math.sqrt((v * v).mean())), 4) if len(v) else None,
        })
    answer["elements"] = elements
    answer["offsets"] = [round(float(v), 4) for v in offsets]
    answer["elementStats"] = stats
    answer["rms"] = round(float(math.sqrt((offsets * offsets).mean())), 4)
    answer["max"] = round(float(np.abs(offsets).max()), 4)


# ── the request ──────────────────────────────────────────────────────────────

def align_payload(payload):
    """The answer to `POST /align`.

    Body: {"points": [[e, n], ...], "station0": m, "straights": [[from, to], ...] | null,
           "settings": {window, tolerance, step, spacing, sagitta, minLength, chord}}
    Answers {stations, kappa, straights, auto, gaps, settings, curves, elements,
    offsets, elementStats, rms, max} — or with `error` (and `errorParams`) where
    no chain could be made, the curvature and the straights still there for the
    user to correct. A body that is not one raises ValueError.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload")
    points = payload.get("points")
    if not isinstance(points, list):
        raise ValueError("points")
    if len(points) > MAX_POINTS:
        raise ValueError("too many points")
    straights = payload.get("straights")
    if straights is not None:
        if not isinstance(straights, list):
            raise ValueError("straights")
        straights = [(float(a), float(b)) for a, b in straights]
    settings = payload.get("settings") or {}
    if not isinstance(settings, dict):
        raise ValueError("settings")
    try:
        return align(points, float(payload.get("station0") or 0.0), straights, settings)
    except AlignError as exc:
        return {"error": exc.code, "errorParams": exc.params}
