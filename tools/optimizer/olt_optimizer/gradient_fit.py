"""A gradient from the heights of measured axis points — with the alignment fit (AP 12.5).

The axis points of a trace carry the top of rail (SO, the lower head —
Entscheidung 130). Stationed along the fitted chain, they give the vertical
alignment of the new track in the app's form: height points at the changes of
gradient, each with the radius of the vertical curve rounding it, the first at
station 0 and the last at the chain's length (heightUtils.js).

1. The heights are taken as the median in **bins** of BIN metres — a few
   points a bin, the odd stray head height does not pull.
2. The **gradient diagram** g(s): the slope of the best-fit line through the
   bins within GRADE_CHORD. A constant gradient is a plateau in it, a vertical
   curve a ramp — the parabola of radius R changes the gradient by 1/R a metre.
   Its own slope, read the same way over CURVATURE_CHORD, is the curvature 1/R.
3. **Constant gradients** are the runs of bins where that curvature stays under
   1/R_FLAT — on a track as rough as a real one, under a few times its
   scatter — at least MIN_GRADE long; each gets its best-fit line. A run whose
   line leaves bins further off than the tolerance is split where it is worst
   — a change of gradient without a curve the diagram did not see. Runs of the
   same gradient one behind the other (a gap in the points between them, a
   noisy stretch) are one.
4. Where the points start or end inside a vertical curve, the first or last
   END_GRADE metres get a line of their own.
5. **Changes of gradient**: two neighbouring lines meet at the height point;
   the tangent length T of the curve between them is fitted to the bins by
   least squares (bounded so it stays within the two runs), R = 2T/|Δg|,
   rounded. A curve shorter than T_MIN is none. Where the bins between two
   runs stay off that curve by more than the tolerance, a short constant
   gradient between two curves hides there — too short for the diagram's
   window — and is looked for by trying it everywhere in between.
6. **Report:** the height difference of every point from the gradient with its
   curves, its RMS and largest.
"""

import math

import numpy as np
from scipy.optimize import minimize_scalar

BIN = 1.0              # m — bins the heights are taken together in
GRADE_CHORD = 15.0     # m — window of the gradient diagram …
CURVATURE_CHORD = 25.0  # m — … and of its slope, longer: it is the noisier
WINDOW_FILL = 0.6      # … of which at least this share must hold bins
R_FLAT = 80000.0       # m — a curvature under 1/R_FLAT is a constant gradient …
FLAT_NOISE = 4.0       # … or under this many times its scatter on a rough track
MIN_GRADE = 20.0       # m — shortest run of constant gradient
SAME_GRADE = 0.0003    # two runs this close in gradient [1] may be one …
END_GRADE = 20.0       # m — a line of its own at an end inside a curve
T_MIN = 1.0            # m — a shorter tangent is no vertical curve
SHORT_GRADE = 10.0     # m — a constant gradient the diagram missed, as tried
MAX_REFINE = 20        # … at most this many times
MIN_POINTS = 10


def _round_radius(r):
    """Radii as a designer states them: whole hundreds from 2000 m, tens below."""
    step = 100.0 if r >= 2000.0 else 10.0
    return max(step, round(r / step) * step)


def _bins(s, z):
    """Median height per bin of BIN metres: (stations, heights), stations the bins' mean."""
    key = np.floor(s / BIN).astype(int)
    order = np.argsort(key, kind="stable")
    key, s, z = key[order], s[order], z[order]
    cuts = np.flatnonzero(np.diff(key)) + 1
    bs = np.array([g.mean() for g in np.split(s, cuts)])
    bz = np.array([np.median(g) for g in np.split(z, cuts)])
    return bs, bz


def _window_slope(x, y, half):
    """The slope of the best-fit line through the values within `half` of every x;
    NaN where the window holds too few of them."""
    out = np.full(len(x), np.nan)
    ok = np.isfinite(y)
    xs, ys = x[ok], y[ok]
    if len(xs) < 3:
        return out
    c = np.concatenate([[0.0], np.cumsum(xs)])
    cy = np.concatenate([[0.0], np.cumsum(ys)])
    cxx = np.concatenate([[0.0], np.cumsum(xs * xs)])
    cxy = np.concatenate([[0.0], np.cumsum(xs * ys)])
    lo = np.searchsorted(xs, x - half, side="left")
    hi = np.searchsorted(xs, x + half, side="right")
    n = hi - lo
    need = max(3, int(WINDOW_FILL * 2 * half / BIN))
    sx, sy = c[hi] - c[lo], cy[hi] - cy[lo]
    sxx, sxy = cxx[hi] - cxx[lo], cxy[hi] - cxy[lo]
    with np.errstate(invalid="ignore", divide="ignore"):
        den = n * sxx - sx * sx
        slope = (n * sxy - sx * sy) / den
    good = (n >= need) & (den > 0)
    out[good] = slope[good]
    return out


def _line(s, z):
    """Best-fit line z = a + g·s: (a, g)."""
    if len(s) < 2 or np.ptp(s) == 0:
        return float(np.mean(z)), 0.0
    g, a = np.polyfit(s, z, 1)
    return float(a), float(g)


def _runs(mask):
    """[(i, j)] of the runs of True in mask, j inclusive."""
    out, i = [], None
    for k, m in enumerate(mask):
        if m and i is None:
            i = k
        elif not m and i is not None:
            out.append((i, k - 1))
            i = None
    if i is not None:
        out.append((i, len(mask) - 1))
    return out


def _split(bs, bz, i, j, tol, out):
    """The run i…j as lines within `tol`, split at the worst bin where one does not do."""
    a, g = _line(bs[i:j + 1], bz[i:j + 1])
    res = np.abs(bz[i:j + 1] - (a + g * bs[i:j + 1]))
    k = int(res.argmax())
    if res[k] <= tol or bs[j] - bs[i] < 2 * MIN_GRADE or k < 2 or k > j - i - 2:
        out.append((i, j))
        return
    _split(bs, bz, i, i + k, tol, out)
    _split(bs, bz, i + k, j, tol, out)


def _flat_limit(bs, k):
    """The curvature under which a gradient counts as constant: 1/R_FLAT, or
    FLAT_NOISE times the scatter of the curvature where the track is not
    smooth enough for that. The scatter is read from the differences a
    window apart — inside a curve as well as on a constant gradient they are
    only the noise."""
    w = max(1, int(round(CURVATURE_CHORD / BIN)))
    if len(k) <= w:
        return 1.0 / R_FLAT
    d = k[w:] - k[:-w]
    d = d[np.isfinite(d)]
    if len(d) < 10:
        return 1.0 / R_FLAT
    sigma = 1.4826 * float(np.median(np.abs(d))) / math.sqrt(2)
    return max(1.0 / R_FLAT, FLAT_NOISE * sigma)


def _stretches(bs, bz, tol):
    """The runs of constant gradient (step 3, 4), as [(i, j)] of bins in order."""
    g = _window_slope(bs, bz, GRADE_CHORD / 2)
    k = _window_slope(bs, g, CURVATURE_CHORD / 2)
    flat = np.isfinite(k) & (np.abs(k) < _flat_limit(bs, k))
    runs = [(i, j) for i, j in _runs(flat) if bs[j] - bs[i] >= MIN_GRADE]
    split = []
    for i, j in runs:
        _split(bs, bz, i, j, tol, split)
    # Neighbours of the same gradient whose common line holds are one.
    merged = []
    for r in split:
        if merged:
            p = merged[-1]
            _, g1 = _line(bs[p[0]:p[1] + 1], bz[p[0]:p[1] + 1])
            _, g2 = _line(bs[r[0]:r[1] + 1], bz[r[0]:r[1] + 1])
            a, gg = _line(bs[p[0]:r[1] + 1], bz[p[0]:r[1] + 1])
            if abs(g1 - g2) < SAME_GRADE and np.abs(bz[p[0]:r[1] + 1] - (a + gg * bs[p[0]:r[1] + 1])).max() <= tol:
                merged[-1] = (p[0], r[1])
                continue
        merged.append(r)
    # The ends: where the points run on beyond the first or last run by more
    # than a curve could take, a line of their own.
    if not merged:
        return [(0, len(bs) - 1)] if len(bs) >= 2 else []
    first, last = merged[0], merged[-1]
    a, gg = _line(bs[first[0]:first[1] + 1], bz[first[0]:first[1] + 1])
    if first[0] > 0 and np.abs(bz[:first[0]] - (a + gg * bs[:first[0]])).max() > tol:
        end = int(np.searchsorted(bs, bs[0] + END_GRADE)) - 1
        if 0 < end < first[0]:
            merged.insert(0, (0, end))
    a, gg = _line(bs[last[0]:last[1] + 1], bz[last[0]:last[1] + 1])
    n = len(bs)
    if last[1] < n - 1 and np.abs(bz[last[1] + 1:] - (a + gg * bs[last[1] + 1:])).max() > tol:
        start = int(np.searchsorted(bs, bs[-1] - END_GRADE))
        if last[1] < start < n - 1:
            merged.append((start, n - 1))
    return merged


def _curve_z(s, pvi, z0, g1, g2, t):
    """Heights of two gradients meeting at (pvi, z0), rounded over ±t."""
    x = s - pvi
    lin = z0 + np.where(x < 0, g1 * x, g2 * x)
    if t <= 0:
        return lin
    inside = np.abs(x) < t
    par = z0 + g1 * x + (x + t) ** 2 * (g2 - g1) / (4 * t)
    return np.where(inside, par, lin)


def gradient_at(heights, s):
    """Heights of the gradient `heights` ([{station, z, rv}]) at stations s —
    the polygon, and inside a vertical curve its parabola (heightUtils.gradientAt)."""
    st = np.array([h["station"] for h in heights])
    zz = np.array([h["z"] for h in heights])
    out = np.interp(s, st, zz)
    for i in range(1, len(heights) - 1):
        rv = heights[i].get("rv")
        if not rv:
            continue
        g1 = (zz[i] - zz[i - 1]) / (st[i] - st[i - 1])
        g2 = (zz[i + 1] - zz[i]) / (st[i + 1] - st[i])
        t = abs(rv) * abs(g2 - g1) / 2
        x = s - st[i]
        inside = np.abs(x) < t
        out = np.where(inside, zz[i] + g1 * x + (x + t) ** 2 * (g2 - g1) / (4 * t), out)
    return out


def _build(bs, bz, runs, length):
    """The gradient of the runs: their lines meeting at the height points, a
    vertical curve fitted at each (step 5). Unrounded."""
    lines = [_line(bs[i:j + 1], bz[i:j + 1]) for i, j in runs]

    # The changes of gradient: where two lines meet, held between their runs.
    pts = []
    for k in range(1, len(runs)):
        (a1, g1), (a2, g2) = lines[k - 1], lines[k]
        lo, hi = bs[runs[k - 1][1]], bs[runs[k][0]]
        if abs(g2 - g1) > 1e-9:
            pvi = (a1 - a2) / (g2 - g1)
            if not lo - MIN_GRADE <= pvi <= hi + MIN_GRADE:
                pvi = (lo + hi) / 2
        else:
            pvi = (lo + hi) / 2
        pvi = min(max(pvi, bs[runs[k - 1][0]] + BIN), bs[runs[k][1]] - BIN)
        pts.append({"station": pvi, "z": a1 + g1 * pvi,
                    "room": (pvi - bs[runs[k - 1][0]], bs[runs[k][1]] - pvi)})
    # The heights of the polygon, so neighbouring changes share their gradients.
    zs = [lines[0][0] + lines[0][1] * 0.0] + [p["z"] for p in pts] + [lines[-1][0] + lines[-1][1] * length]
    ss = [0.0] + [p["station"] for p in pts] + [float(length)]
    heights = [{"station": 0.0, "z": zs[0]}]
    for k, p in enumerate(pts, start=1):
        g1 = (zs[k] - zs[k - 1]) / max(ss[k] - ss[k - 1], 1e-6)
        g2 = (zs[k + 1] - zs[k]) / max(ss[k + 1] - ss[k], 1e-6)
        h = {"station": ss[k], "z": zs[k]}
        dg = abs(g2 - g1)
        tmax = min(p["room"][0], p["room"][1], ss[k] - ss[k - 1], ss[k + 1] - ss[k])
        if dg > 1e-6 and tmax > T_MIN:
            m = (bs > ss[k] - tmax) & (bs < ss[k] + tmax)
            if m.sum() >= 3:
                x, y = bs[m], bz[m]
                fit = minimize_scalar(lambda t: float(((y - _curve_z(x, ss[k], zs[k], g1, g2, t)) ** 2).sum()),
                                      bounds=(0.0, tmax), method="bounded", options={"xatol": 0.05})
                t = float(fit.x)
                if t >= T_MIN:
                    h["rv"] = _round_radius(2 * t / dg)
        heights.append(h)
    heights.append({"station": float(length), "z": zs[-1]})
    # A radius rounded up may reach into its neighbour's curve: then it is
    # cut back to where they touch.
    t_prev = 0.0
    for k in range(1, len(heights) - 1):
        rv = heights[k].get("rv")
        if not rv:
            t_prev = 0.0
            continue
        a, b, c = heights[k - 1], heights[k], heights[k + 1]
        g1 = (b["z"] - a["z"]) / (b["station"] - a["station"])
        g2 = (c["z"] - b["z"]) / (c["station"] - b["station"])
        dg = abs(g2 - g1)
        tmax = min(b["station"] - a["station"] - t_prev, c["station"] - b["station"])
        if rv * dg / 2 > tmax:
            rv = math.floor(2 * tmax / dg / 10) * 10
            if rv * dg / 2 < T_MIN:
                del heights[k]["rv"]
                t_prev = 0.0
                continue
            heights[k]["rv"] = rv
        t_prev = rv * dg / 2
    return heights


def _refine(bs, bz, runs, length, tol):
    """Where the points between two runs stay off the curve joining them, a
    short constant gradient between two curves was too short for the diagram
    to see: a run of SHORT_GRADE is tried at every place in between, and the
    best one kept if it takes the largest difference down by half (step 5)."""
    for _ in range(MAX_REFINE):
        heights = _build(bs, bz, runs, length)
        res = np.abs(bz - gradient_at(heights, bs))
        worst = None
        for k in range(1, len(runs)):
            lo, hi = runs[k - 1][1] + 1, runs[k][0]
            if hi - lo < 3 or res[lo:hi].max() <= tol:
                continue
            if worst is None or res[lo:hi].max() > worst[1]:
                worst = (k, res[lo:hi].max())
        if worst is None:
            return heights
        k, before = worst
        lo, hi = runs[k - 1][1] + 1, runs[k][0] - 1
        best = None
        for c in np.arange(bs[lo] + SHORT_GRADE / 2, bs[hi] - SHORT_GRADE / 2 + 1e-9, BIN * 2):
            i = int(np.searchsorted(bs, c - SHORT_GRADE / 2))
            j = int(np.searchsorted(bs, c + SHORT_GRADE / 2)) - 1
            if j - i < 3 or i <= runs[k - 1][1] or j >= runs[k][0]:
                continue
            trial = runs[:k] + [(i, j)] + runs[k:]
            span = slice(runs[k - 1][0], runs[k][1] + 1)
            err = np.abs(bz[span] - gradient_at(_build(bs, bz, trial, length), bs[span])).max()
            if best is None or err < best[0]:
                best = (err, trial)
        if best is None or best[0] > before / 2:
            return heights
        runs = best[1]
    return _build(bs, bz, runs, length)


def fit_gradient(s, z, length, tolerance=0.01):
    """The gradient of points at stations `s` [m along the chain] with heights
    `z` [m] for a track `length` long. Returns {heights, offsets, rms, max} —
    offsets per point in the order given, None where it has no height — or
    None where there are too few heights to say."""
    s = np.asarray(s, dtype=float)
    z = np.asarray(z, dtype=float)
    have = np.isfinite(s) & np.isfinite(z)
    if have.sum() < MIN_POINTS or np.ptp(s[have]) < MIN_GRADE:
        return None
    bs, bz = _bins(s[have], z[have])
    runs = _stretches(bs, bz, tolerance)
    if not runs:
        return None
    heights = _refine(bs, bz, runs, length, tolerance)
    for h in heights:
        h["station"] = round(float(h["station"]), 3)
        h["z"] = round(float(h["z"]), 4)

    off = np.full(len(s), np.nan)
    off[have] = z[have] - gradient_at(heights, s[have])
    v = off[have]
    return {
        "heights": heights,
        "offsets": [None if not math.isfinite(d) else round(float(d), 4) for d in off],
        "rms": round(float(math.sqrt((v * v).mean())), 4),
        "max": round(float(np.abs(v).max()), 4),
    }
