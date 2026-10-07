"""Reconnecting existing elements — "Bestehende Elemente neu verbinden" (Paket N).

A stretch of one track is replaced: the app hands over the element before it
and the one after it as the two picks of a splice (splice.py), the departure
joined at its end and the arrival at its start, and the axis the stretch had
as points every centimetre — the elements chosen and, where the splice may
re-shape them, the two neighbours. The splice construction joins the two
ends again; what is free in it is searched so that the new axis lies within
`tolerance` of the old one everywhere and keeps the rules at the design speed
(Entscheidung 189):

* two straights, an arc and a straight: the radius (whole metres, a grid from
  R_MIN to R_MAX, then narrowed around the best), at each radius the cant the
  app proposes for it (clearance.auto_cant) and the transitions at their
  Regellänge, their Mindestlänge or none;
* two arcs: a straight between them with transitions at the Regellänge, the
  Mindestlänge or none — or one transition straight from arc to arc.

Every candidate is the splice's own (`_solve`, the transition lengths settled
in the chain they stand in), checked for loops, measured against the points
both ways — every point to the new axis and the new axis to the points — and,
where it lies within the tolerance, judged by the rule catalogue (`_judge`).
Best first (Entscheidung 190): within the tolerance before beyond it, then
the lightest finding (an error is never proposed for adoption by the app),
then the smallest largest deviation, then the smallest RMS. The answer names
the best of every variant.
"""

import math

import numpy as np
from scipy.spatial import cKDTree

from .alignment_fit import piece_points, project
from .clearance import auto_cant
from .geometry import sample_transition, _transition_steps
from .splice import (
    SpliceError, _centre_of, _cost, _judge, _katalog, _loops, _pick, _solve,
)

# The radius search: a geometric grid between these [m] …
R_MIN = 50.0
R_MAX = 50000.0
GRID = 48
# … then this many radii between the two grid neighbours of the best, so many times.
ZOOM = 10
ZOOM_ROUNDS = 4
# Where a transition is asked for at its Regellänge or Mindestlänge, the
# fixed point of `_solve` starts from this length [m].
LENGTH_START = 60.0
# Points between two the search measures with — the final measure takes all.
SEARCH_SPACING = 0.25
# The deviation band the panel draws: one value per this much station [m],
# the largest in it, so no peak is lost.
BAND_STEP = 0.5
# Far more points than any stretch a dialog replaces (5 km at 1 cm).
MAX_POINTS = 500_000

LENGTH_MODES = ("regular", "minimum", "none")


# ── the points ───────────────────────────────────────────────────────────────

def _points(raw):
    """The old axis from the request: {e0, n0, de, dn} with de, dn in whole
    millimetres from (e0, n0), in travel order."""
    if not isinstance(raw, dict):
        raise ValueError("points")
    e0, n0 = float(raw["e0"]), float(raw["n0"])
    de, dn = raw.get("de"), raw.get("dn")
    if not isinstance(de, list) or not isinstance(dn, list) or len(de) != len(dn) or len(de) < 2:
        raise ValueError("points")
    if len(de) > MAX_POINTS:
        raise ValueError("points: too many")
    pts = np.stack([e0 + np.asarray(de, dtype=float) / 1000.0, n0 + np.asarray(dn, dtype=float) / 1000.0], axis=1)
    return pts


class Reference:
    """The old axis: its points, their stations, a tree to find the nearest,
    and the thinned set the search measures with."""

    def __init__(self, pts):
        self.pts = pts
        steps = np.hypot(*np.diff(pts, axis=0).T)
        self.station = np.concatenate([[0.0], np.cumsum(steps)])
        spacing = float(np.median(steps)) if len(steps) else 0.01
        stride = max(1, int(round(SEARCH_SPACING / max(spacing, 1e-6))))
        idx = np.arange(0, len(pts), stride)
        if idx[-1] != len(pts) - 1:
            idx = np.append(idx, len(pts) - 1)
        self.thin = pts[idx]
        self.tree = cKDTree(pts)


# ── a chain as a line ────────────────────────────────────────────────────────

def chain_polyline(els):
    """The chain of a solution as a polyline, dense enough to measure
    millimetres against (the alignment fit's sampling)."""
    out = []
    for el in els:
        length = float(el.get("length") or 0.0)
        p = (float(el["startNode"][0]), float(el["startNode"][1]))
        if length <= 1e-9:
            q = np.array([p])
        elif el["elementType"] == 0:
            q = piece_points({"kind": "straight", "start": p, "bearing": el["bearing"], "length": length})
        elif el["elementType"] == 1:
            q = piece_points({"kind": "arc", "start": p, "bearing": el["bearing"], "length": length, "r": el["radius"]})
        else:
            r1, r2 = el.get("r1"), el.get("r2")
            q = np.array(sample_transition(p[0], p[1], el["bearing"], length, r1, r2,
                                           el.get("transitionType") or "clothoid",
                                           max(_transition_steps(length, r1, r2), int(math.ceil(length)))))
        out.append(q if not out else q[1:])
    return np.concatenate(out) if out else np.zeros((0, 2))


def _measure(ref, poly, full):
    """How far the new axis `poly` lies from the old one: {max, rms} — and
    with `full` the offset of every point (new axis against old, > 0 to the
    right in travel), measured with every point instead of the thinned ones."""
    pts = ref.pts if full else ref.thin
    off, _, _ = project(pts, poly)
    worst = float(np.abs(off).max())
    # The other way round: no stretch of the new axis may run away from the
    # old one where no point would notice (the old axis has a point every centimetre).
    back, _, _ = project(poly, ref.pts, ref.tree)
    worst_back = float(np.abs(back).max())
    out = {"max": max(worst, worst_back), "rms": float(math.sqrt(float((off * off).mean())))}
    if full:
        out["offsets"] = -off
    return out


def _band(ref, offsets):
    """The deviation over the station of the old axis, one value per
    BAND_STEP — the largest in it, signed — as [[station, offset], …] [m]."""
    st = ref.station
    bins = np.floor(st / BAND_STEP).astype(int)
    out = []
    start = 0
    for k in range(1, len(st) + 1):
        if k == len(st) or bins[k] != bins[start]:
            seg = offsets[start:k]
            j = start + int(np.abs(seg).argmax())
            out.append([round(float(st[j]), 2), round(float(offsets[j]), 4)])
            start = k
    return out


# ── candidates ───────────────────────────────────────────────────────────────

def _spec(base, variant, radius):
    """The splice settings for one candidate: `variant` {lengths, arcJoin}."""
    mode = variant["lengths"]
    on = mode != "none" and variant["arcJoin"] != "transition"
    start = LENGTH_START if on else 0.0
    return {
        **base,
        "radius": radius or 0.0,
        "cant": auto_cant(base["speed"], radius, base["cantModel"]) if radius else 0.0,
        "lengths": [start, start],
        "modes": [mode, mode] if on else ["fixed", "fixed"],
        "arcJoin": variant["arcJoin"],
    }


class Search:
    """Builds and measures the candidates of one request."""

    def __init__(self, picks, ref, base, tolerance, l_min):
        self.picks = picks
        self.ref = ref
        self.base = base
        self.tol = tolerance
        self.l_min = l_min
        self.k = _katalog()

    def build(self, variant, radius):
        """The splice of one variant at `radius` (None for two arcs), measured
        with the thinned points — or None where it does not fit."""
        spec = _spec(self.base, variant, radius)
        try:
            sol = _solve(self.picks, ("end", "start"), spec)
        except SpliceError:
            return None
        if _loops(sol, self.picks):
            return None
        # The new arc an element of its own (Entscheidung 169): else the old
        # arc runs on and a sliver of any radius closes the gap.
        if radius and sol["info"].get("arcLength", 0.0) < self.l_min:
            return None
        poly = chain_polyline(sol["elements"])
        if len(poly) < 2:
            return None
        dev = _measure(self.ref, poly, full=False)
        cand = {"sol": sol, "spec": spec, "variant": variant, "radius": radius, "dev": dev, "poly": poly}
        cand["within"] = dev["max"] <= self.tol
        if cand["within"]:
            _judge(sol)
        return cand

    def key(self, cand):
        """Best first: within the tolerance, the lightest finding, the smallest
        largest deviation, the smallest RMS."""
        if cand is None:
            return (2, 0, math.inf, math.inf)
        rank = self.k.rank(cand["sol"]["worst"]) if cand["within"] else 0
        return (0 if cand["within"] else 1, rank, round(cand["dev"]["max"], 4), cand["dev"]["rms"])

    def best_radius(self, variant, fixed=None):
        """The best candidate of a variant with a radius of its own to choose:
        on a geometric grid, then narrowed between the grid neighbours of the
        best, in whole metres at the end."""
        if fixed:
            return self.build(variant, float(fixed))
        r_hi = R_MAX
        grid = [R_MIN * (r_hi / R_MIN) ** (i / (GRID - 1)) for i in range(GRID)]
        tried = {}

        def at(r):
            r = float(r)
            if r not in tried:
                tried[r] = self.build(variant, r)
            return tried[r]

        cands = [at(r) for r in grid]
        if all(c is None for c in cands):
            return None
        i = min(range(len(grid)), key=lambda j: self.key(cands[j]))
        lo, hi = grid[max(0, i - 1)], grid[min(len(grid) - 1, i + 1)]
        best_r = grid[i]
        for _ in range(ZOOM_ROUNDS):
            rs = [lo + (hi - lo) * j / (ZOOM - 1) for j in range(ZOOM)]
            for r in rs:
                if self.key(at(r)) < self.key(at(best_r)):
                    best_r = r
            step = (hi - lo) / (ZOOM - 1)
            lo, hi = max(R_MIN, best_r - step), min(R_MAX, best_r + step)
        # Whole metres, the better of the two around it.
        whole = [math.floor(best_r), math.ceil(best_r)]
        return min((at(r) for r in whole if r >= 1), key=self.key)

    def finish(self, cand):
        """A candidate measured with every point, judged and as the answer has it."""
        sol = cand["sol"]
        dev = _measure(self.ref, cand["poly"], full=True)
        within = dev["max"] <= self.tol
        if "worst" not in sol:
            _judge(sol)
        offsets = dev.pop("offsets")
        j = int(np.abs(offsets).argmax())
        sol["rebuilt"] = _cost(sol, self.picks)
        sol["alternative"] = False
        if self.picks[0]["radius"] is not None and self.picks[1]["radius"] is not None:
            sol["arcJoin"] = cand["variant"]["arcJoin"]
        sol["reconnect"] = {
            "variant": cand["variant"],
            "radius": cand["radius"],
            "cant": cand["spec"]["cant"],
            "within": within,
            "max": round(dev["max"], 4),
            "rms": round(dev["rms"], 4),
            "worstAt": [round(float(x), 3) for x in self.ref.pts[j]],
            "worstStation": round(float(self.ref.station[j]), 2),
            "band": _band(self.ref, offsets),
        }
        return sol


# Two circles this close are one [m].
SAME_CIRCLE = 1e-3


def _same_circle(picks):
    """Do both ends lie on one circle, curving the same way? Then there is
    nothing between them to join — the arc runs on — and no construction of
    the splice fits."""
    a, b = picks
    if a["radius"] is None or b["radius"] is None or abs(a["radius"] - b["radius"]) > SAME_CIRCLE:
        return False
    return math.dist(_centre_of(a["end"], a["bearing"], a["radius"]),
                     _centre_of(b["end"], b["bearing"], b["radius"])) < SAME_CIRCLE


def _variants(picks):
    two_arcs = picks[0]["radius"] is not None and picks[1]["radius"] is not None
    out = [{"lengths": m, "arcJoin": "straight"} for m in LENGTH_MODES]
    if two_arcs:
        out.append({"lengths": "none", "arcJoin": "transition"})
    return out, two_arcs


def _rank_answer(search, sol):
    r = sol["reconnect"]
    return (0 if r["within"] else 1, search.k.rank(sol["worst"]) if r["within"] else 0, r["max"], r["rms"])


def reconnect_payload(payload):
    """The answer to `POST /reconnect`.

    Body: {"dep": pick, "arr": pick — the splice's picks (splice_payload), the
    element before the stretch and the one after it, each with `joinAt`;
    "points": {"e0", "n0", "de": [mm], "dn": [mm]} the old axis in travel
    order; "tolerance": m; "speed": km/h; "transition": "clothoid"|"bloss";
    "radius": m to keep it fixed (0: searched); "cantModel": the app's
    proposal of the cant (clearance.auto_cant); "lMin": m the shortest new
    arc (LP.EL.01 at that speed)}.

    Answers {"solutions": [...]} — the best of every variant, best first, each
    a splice solution (splice_payload) with `reconnect`: {variant {lengths,
    arcJoin}, radius, cant, within, max, rms, worstAt, worstStation, band}
    — or {"error": key, "params": {}} where no variant fits at all.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload")
    picks = [_pick(payload.get("dep")), _pick(payload.get("arr"))]
    if picks[0]["joinAt"] != "end" or picks[1]["joinAt"] != "start":
        raise ValueError("joinAt")
    ref = Reference(_points(payload.get("points")))
    tolerance = float(payload.get("tolerance") or 0)
    if not tolerance > 0:
        raise ValueError("tolerance")
    speed = max(0.0, float(payload.get("speed") or 0))
    profile = payload.get("transition", "clothoid")
    if profile not in ("clothoid", "bloss"):
        raise ValueError("transition")
    model = payload.get("cantModel") or {}
    if speed > 0 and not all(k in model for k in ("coeff", "defCoeff", "max")):
        raise ValueError("cantModel")
    base = {"speed": speed, "profile": profile, "cantModel": model}
    fixed = float(payload.get("radius") or 0)
    search = Search(picks, ref, base, tolerance, max(0.0, float(payload.get("lMin") or 0)))

    if _same_circle(picks):
        return {"error": "reconnect_error_same_circle", "params": {}}
    variants, two_arcs = _variants(picks)
    best = []
    for v in variants:
        cand = search.build(v, None) if two_arcs else search.best_radius(v, fixed or None)
        if cand is not None:
            best.append(search.finish(cand))
    if not best:
        return {"error": "reconnect_error_no_fit", "params": {}}
    best.sort(key=lambda sol: _rank_answer(search, sol))
    return {"solutions": best, "tolerance": tolerance}
