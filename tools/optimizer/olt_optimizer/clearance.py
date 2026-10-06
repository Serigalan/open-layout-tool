"""Track spacing of a splice to a neighbouring track — and the largest radius that keeps it.

The splice dialog may name a track the new geometry has to keep its distance
to (Entscheidung 167). The distance asked for is the user's minimum spacing
`dMin` (the Regelgleisabstand of Ril 800.0130, 4.00 m on most lines), widened
where cant leans the two clearance profiles towards each other (Entscheidung
168, read geometrically): both profiles are turned by their cant about the
running circle of the rail that stays down, as the cross section draws them,
and the widening is how much further apart the two centre lines then have to
be for the turned outlines not to overlap, against the same at no cant. Both
tracks are taken at the same height of their lower rail — the new track has no
gradient yet.

What is checked is what the splice inserts: every element of role 'new', at
1 m steps, each with its cant — the dialog's cant on the new arc (with the
maximum search: the cant the app proposes for that radius), linear over a
clothoid ramp and the Bloss curve over a Bloss one, the cant of the picked arcs
on the elements they keep. The neighbour comes as points along its axis with
its cant (the app's sign: positive raises the left rail), in the plane of the
splice.
"""

import math

from .geometry import sample_arc, sample_transition

try:
    import numpy as _np
except ImportError:                                   # pragma: no cover
    _np = None

RUNNING_CIRCLE_DISTANCE = 1500.0     # mm, the lever of the cant
HALF_RUNNING = RUNNING_CIRCLE_DISTANCE / 2
# Height step the two outlines are compared at [mm].
Z_STEP = 10.0
# Step along the new elements [m].
SAMPLE_STEP = 1.0
# How far beyond the two picked elements the neighbour is still read [m].
REF_MARGIN = 100.0
# The radius search: from this down …
R_MAX = 50000.0
# … to this, in steps of this ratio, then halved to the metre.
R_MIN = 50.0
R_RATIO = 0.92


# ── the outline turned by the cant ───────────────────────────────────────────

def profile_ring(half):
    """The closed outline from its stated half ([y, z] in mm, y ≥ 0), mirrored at the centre line."""
    pts = [(float(y), float(z)) for y, z in half]
    back = [(-y if abs(y) > 1e-9 else 0.0, z) for y, z in reversed(pts)]
    if abs(pts[-1][0]) <= 1e-9:
        back = back[1:]
    ring = pts + back
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def turned(ring, cant):
    """The outline turned by `cant` [mm, app sign] about the running circle that stays down."""
    angle = -math.asin(max(-1.0, min(1.0, cant / RUNNING_CIRCLE_DISTANCE)))
    py = -HALF_RUNNING if cant < 0 else HALF_RUNNING
    c, s = math.cos(angle), math.sin(angle)
    return [((y - py) * c - z * s + py, (y - py) * s + z * c) for y, z in ring]


def _spans(ring, zs):
    """Per height the outline's [y_min, y_max], or None where it does not reach."""
    out = []
    for z in zs:
        ys = []
        for (y1, z1), (y2, z2) in zip(ring[:-1], ring[1:]):
            if (z1 <= z <= z2) or (z2 <= z <= z1):
                if abs(z2 - z1) < 1e-12:
                    ys.extend((y1, y2))
                else:
                    ys.append(y1 + (y2 - y1) * (z - z1) / (z2 - z1))
        out.append((min(ys), max(ys)) if ys else None)
    return out


class Spacing:
    """How far apart two centre lines have to be for the two turned outlines to clear each other."""

    def __init__(self, half_profile):
        self.ring = profile_ring(half_profile)
        top = max(z for _, z in self.ring) + RUNNING_CIRCLE_DISTANCE
        self.zs = [-RUNNING_CIRCLE_DISTANCE + i * Z_STEP
                   for i in range(int((top + RUNNING_CIRCLE_DISTANCE) / Z_STEP) + 1)]
        self._cache = {}
        self.base = self.needed(0.0, 0.0, 1)

    def _span_of(self, cant):
        key = round(cant, 1)
        if key not in self._cache:
            self._cache[key] = _spans(turned(self.ring, key), self.zs)
        return self._cache[key]

    def needed(self, cant_here, cant_there, side):
        """Centre distance [mm] at which the outline of a track with `cant_there`,
        lying to the right of this one (`side` +1) or to its left (−1) and read
        in this track's frame, just clears this one's with `cant_here`."""
        a, b = self._span_of(cant_here), self._span_of(cant_there)
        worst = -math.inf
        for sa, sb in zip(a, b):
            if sa is None or sb is None:
                continue
            worst = max(worst, sa[1] - sb[0] if side > 0 else sb[1] - sa[0])
        return worst

    def widening(self, cant_here, cant_there, side):
        """What the cant adds to the spacing [m] — never less than nothing."""
        return max(0.0, self.needed(cant_here, cant_there, side) - self.base) / 1000.0


# ── the new elements, sampled with their cant ────────────────────────────────

def _bloss(t):
    return t * t * (3.0 - 2.0 * t)


def _element_cants(chain, cant_of_arc):
    """Cant at both ends of every element: arcs their own, straights none,
    transitions ramping between their neighbours."""
    ends = []
    for el in chain:
        if el["elementType"] == 1:
            c = cant_of_arc(el)
            ends.append((c, c))
        elif el["elementType"] == 0:
            ends.append((0.0, 0.0))
        else:
            ends.append(None)
    for i, el in enumerate(chain):
        if ends[i] is not None:
            continue
        before = ends[i - 1][1] if i > 0 and ends[i - 1] is not None else 0.0
        after = ends[i + 1][0] if i + 1 < len(chain) and ends[i + 1] is not None else 0.0
        ends[i] = (before, after)
    return ends


def sample_new(chain, cant_of_arc):
    """Points of the elements the splice inserts: [(e, n, bearing°, cant)]."""
    ends = _element_cants(chain, cant_of_arc)
    out = []
    for el, (c0, c1) in zip(chain, ends):
        if el.get("role", "new") != "new" or not el.get("length", 0) > 0:
            continue
        s, e = el["startNode"], el["endNode"]
        n = max(2, math.ceil(el["length"] / SAMPLE_STEP))
        if el["elementType"] == 0:
            pts = [(s[0] + (e[0] - s[0]) * i / n, s[1] + (e[1] - s[1]) * i / n) for i in range(n + 1)]
        elif el["elementType"] == 1:
            pts = sample_arc(s[0], s[1], e[0], e[1], el["radius"], max_step_angle=SAMPLE_STEP / abs(el["radius"]))
        else:
            pts = sample_transition(s[0], s[1], el["bearing"], el["length"], el.get("r1"), el.get("r2"),
                                    el.get("transitionType", "clothoid"), steps=n)
        bloss = el["elementType"] == 2 and el.get("transitionType") == "bloss"
        m = len(pts) - 1
        for i, (x, y) in enumerate(pts):
            j0, j1 = max(0, i - 1), min(m, i + 1)
            bearing = math.degrees(math.atan2(pts[j1][0] - pts[j0][0], pts[j1][1] - pts[j0][1])) % 360.0
            t = i / m if m else 0.0
            cant = c0 + (c1 - c0) * (_bloss(t) if bloss else t)
            out.append((x, y, bearing, cant))
    return out


# ── the neighbour ────────────────────────────────────────────────────────────

class Neighbour:
    """The axis of the track kept clear of: points with the cant there, cut to
    what lies near the splice."""

    def __init__(self, points, box):
        e0, n0, e1, n1 = box
        keep = [i for i, p in enumerate(points)
                if e0 - REF_MARGIN <= p[0] <= e1 + REF_MARGIN and n0 - REF_MARGIN <= p[1] <= n1 + REF_MARGIN]
        if not keep:
            self.pts = []
            return
        lo, hi = max(0, keep[0] - 1), min(len(points), keep[-1] + 2)
        self.pts = [(float(p[0]), float(p[1]), float(p[2] if len(p) > 2 and p[2] is not None else 0.0))
                    for p in points[lo:hi]]

    def nearest(self, samples):
        """Per sample: (distance [m], side of the neighbour (+1 right), its cant in the
        sample's frame, where on it) — or None without a neighbour nearby."""
        if len(self.pts) < 2 or not samples:
            return [None] * len(samples)
        if _np is None:                               # pragma: no cover
            return [self._nearest_one(s) for s in samples]
        ref = _np.asarray(self.pts)
        a, ab = ref[:-1, :2], ref[1:, :2] - ref[:-1, :2]
        den = (ab * ab).sum(axis=1)
        den[den == 0] = 1.0
        pts = _np.asarray([(s[0], s[1]) for s in samples])
        apx = pts[:, 0, None] - a[None, :, 0]
        apy = pts[:, 1, None] - a[None, :, 1]
        t = (apx * ab[None, :, 0] + apy * ab[None, :, 1]) / den[None, :]
        _np.clip(t, 0.0, 1.0, out=t)
        dx = apx - t * ab[None, :, 0]
        dy = apy - t * ab[None, :, 1]
        d2 = dx * dx + dy * dy
        k = d2.argmin(axis=1)
        rows = _np.arange(len(samples))
        return [self._describe(samples[i], int(k[i]), float(t[i, k[i]])) for i in rows]

    def _nearest_one(self, sample):                   # pragma: no cover
        best = None
        for k in range(len(self.pts) - 1):
            (ax, ay, _), (bx, by, _) = self.pts[k], self.pts[k + 1]
            dx, dy = bx - ax, by - ay
            den = dx * dx + dy * dy or 1.0
            t = max(0.0, min(1.0, ((sample[0] - ax) * dx + (sample[1] - ay) * dy) / den))
            d = math.hypot(sample[0] - ax - t * dx, sample[1] - ay - t * dy)
            if best is None or d < best[0]:
                best = (d, k, t)
        return self._describe(sample, best[1], best[2])

    def _describe(self, sample, k, t):
        (ax, ay, ca), (bx, by, cb) = self.pts[k], self.pts[k + 1]
        qx, qy = ax + t * (bx - ax), ay + t * (by - ay)
        x, y, bearing, _ = sample
        b = math.radians(bearing)
        right = (math.cos(b), -math.sin(b))
        lateral = (qx - x) * right[0] + (qy - y) * right[1]
        dist = math.hypot(qx - x, qy - y)
        # Read the other way round, the neighbour's left is this track's right:
        # its cant changes sign in this frame.
        along = math.sin(b) * (bx - ax) + math.cos(b) * (by - ay)
        cant = ca + (cb - ca) * t
        return dist, (1 if lateral >= 0 else -1), (cant if along >= 0 else -cant), (qx, qy)


# ── the check and the search ─────────────────────────────────────────────────

def _js_round(x):
    """Math.round: halves up, not to the even neighbour as Python's round."""
    return math.floor(x + 0.5)


def auto_cant(speed, radius, model):
    """The cant the app proposes for `radius` at `speed` (rules/cant computeAutoC,
    its figures in `model`), unsigned [mm]."""
    r = abs(radius)
    if not r > 0 or not speed:
        return 0.0
    if _js_round(model["defCoeff"] * speed * speed / r) < model.get("defMin", 60):
        return 0.0
    step = model.get("step", 5)
    return min(model["max"], _js_round(model["coeff"] * speed * speed / r / step) * step)


def check(chain, neighbour, spacing, d_min, cant_of_arc):
    """The tightest place of the inserted elements: {margin, distance, required,
    cantNew, cantRef, at, ref} — margin < 0 where the spacing is not kept — or
    None where no part of the neighbour lies near."""
    samples = sample_new(chain, cant_of_arc)
    worst = None
    for sample, hit in zip(samples, neighbour.nearest(samples)):
        if hit is None:
            continue
        dist, side, cant_ref, q = hit
        required = d_min + spacing.widening(sample[3], cant_ref, side)
        margin = dist - required
        if worst is None or margin < worst["margin"]:
            worst = {"margin": margin, "distance": dist, "required": required,
                     "cantNew": sample[3], "cantRef": cant_ref, "at": [sample[0], sample[1]], "ref": list(q)}
    return worst


def largest_radius(build, keeps, r_max=R_MAX, r_min=R_MIN):
    """The largest whole-metre radius whose splice `build(r)` (None where it does
    not fit) `keeps(result)` the spacing — searched down from `r_max` on a
    geometric grid, then halved between the last radius that failed and the
    first that held. Returns (radius, result) or (None, None)."""
    def ok(r):
        res = build(r)
        return res if res is not None and keeps(res) else None

    failed = None
    r = r_max
    while r >= r_min:
        res = ok(r)
        if res is not None:
            if failed is None:
                return math.floor(r), build(math.floor(r))
            lo, hi, best = r, failed, res
            while hi - lo > 0.5:
                mid = (lo + hi) / 2
                got = ok(mid)
                if got is not None:
                    lo, best = mid, got
                else:
                    hi = mid
            r_found = math.floor(lo)
            final = ok(r_found)
            return (r_found, final) if final is not None else (lo, best)
        failed = r
        r *= R_RATIO
    return None, None
