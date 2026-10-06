"""Splicing two elements into one chain — the construction of "Elemente verbinden".

Since AP 12.4 this is the only implementation: the panel asks the service
(`POST /splice`), and the alignment fit from measured axis points (phase 12)
builds its arcs with the same functions. It replaces the app's former
src/utils/spliceUtils.js.

The two picked elements come in the plane of their track (one CRS for both):
each with its two ends, the bearing at its picked end in the element's own
direction and its signed radius (None for a straight). The departure element
runs into the splice at its end. The arrival element is met either at its end
and traversed against its direction (a corner, `reverseArr`) or at its start
and run on in its own direction (a continuation). Two straights are met the
way that turns less, or the other where only that one fits; an arc case is
met at the arrival's end nearer the departure — its own geometry, unlike two
straights, leaves no way that merely turns less, and a fallback would let the
search for the largest radius slip into a loop the other way round.

What comes back is the chain from the departure element's start to the far end
of the arrival element, in travel order, every element in the app's plane form
(startNode, endNode, bearing, endBearing, length, radius / r1 r2) and with a
`role`: 'dep' and 'arr' for what is left of the two picked elements, re-shaped,
'new' for what the splice inserts. Speed and cant are the app's to set.

Conventions are the geometry kernel's: bearings in degrees clockwise from grid
north, signed radius > 0 for a right-hand curve.
"""

import math

from . import clearance
from .clearance import Neighbour, Spacing, auto_cant, check, largest_radius
from .geometry import (
    DEG2RAD, RAD2DEG, arc_center, arc_sweep, dir_of, fit_curve_group, transition_end, transition_shift,
    _arc_forward,
)

# A tangent point may lie this far behind the start of its element [m] — the
# rounding of the element ends, not a construction that does not fit.
TOL = 0.01
# Beyond this a transition is not a design any more [m].
MAX_TRANSITION_LENGTH = 5000.0
# Samples along the arc a straight is spliced to, when the leaving point is
# looked for: dense enough that two roots of the closing condition are never
# within one step of each other on any railway geometry.
ARC_STRAIGHT_SAMPLES = 2000


class SpliceError(Exception):
    """A splice that does not fit, `code` being the key the app translates."""

    def __init__(self, code, **params):
        super().__init__(code)
        self.code = code
        self.params = params


# ── elements in the app's form ───────────────────────────────────────────────

def _bearing(frm, to):
    return (math.atan2(to[0] - frm[0], to[1] - frm[1]) * RAD2DEG) % 360.0


def straight(frm, to, role):
    return {
        "elementType": 0, "role": role,
        "startNode": [frm[0], frm[1]], "endNode": [to[0], to[1]],
        "bearing": _bearing(frm, to), "length": math.hypot(to[0] - frm[0], to[1] - frm[1]),
    }


def arc(frm, to, signed_r, role):
    """The arc of `signed_r` from `frm` to `to`, the way it turns — always the one shorter than half a circle."""
    centre = arc_center(frm[0], frm[1], to[0], to[1], signed_r)
    if centre is None:
        raise SpliceError("splice_error_no_fit")
    sweep = abs(arc_sweep(frm[0], frm[1], to[0], to[1], centre[0], centre[1], signed_r))
    side = 1.0 if signed_r > 0 else -1.0
    chord = _bearing(frm, to)
    turn = sweep * RAD2DEG
    return {
        "elementType": 1, "role": role, "radius": signed_r,
        "startNode": [frm[0], frm[1]], "endNode": [to[0], to[1]],
        "bearing": (chord - side * turn / 2) % 360.0, "endBearing": (chord + side * turn / 2) % 360.0,
        "length": sweep * abs(signed_r),
    }


def reshaped_arc(frm, to, signed_r, role, bearing_at, at_end):
    """What is left of a picked arc, re-shaped along its own circle to a junction.

    `arc` takes the shorter way round; the junction may need the longer one —
    the element would wrap more than half its circle — and then its tangent
    there points the wrong way. `bearing_at` is the bearing the chain has at
    the junction (`at_end`: the arc ends there, else it starts there).
    """
    el = arc(frm, to, signed_r, role)
    have = el["endBearing"] if at_end else el["bearing"]
    if abs(_turn(have, bearing_at)) > 1e-3:
        raise SpliceError(f"splice_error_{role}_too_large")
    return el


def transition(frm, bearing, length, r1, r2, profile, role="new", end=None, end_bearing=None):
    """A transition from `frm`; `end`/`end_bearing` snap it onto the construction's own junction."""
    e, n, b = transition_end(frm[0], frm[1], bearing, length, r1, r2, profile)
    return {
        "elementType": 2, "role": role, "transitionType": profile, "r1": r1, "r2": r2,
        "startNode": [frm[0], frm[1]], "endNode": list(end) if end is not None else [e, n],
        "bearing": bearing % 360.0, "endBearing": (end_bearing if end_bearing is not None else b) % 360.0,
        "length": length,
    }


def reversed_element(el):
    """The element run the other way: ends and bearings swapped, curvature negated."""
    out = dict(el)
    out["startNode"], out["endNode"] = el["endNode"], el["startNode"]
    end_b = el.get("endBearing", el["bearing"])
    out["bearing"] = (end_b + 180.0) % 360.0
    out["endBearing"] = (el["bearing"] + 180.0) % 360.0
    if el["elementType"] == 1:
        out["radius"] = -el["radius"]
    if el["elementType"] == 2:
        r1, r2 = el["r1"], el["r2"]
        out["r1"] = -r2 if r2 is not None else None
        out["r2"] = -r1 if r1 is not None else None
    return out


def _turn(frm, to):
    """Signed bearing change from `frm` to `to`, in (-180, 180] degrees."""
    return ((to - frm + 180.0) % 360.0 + 360.0) % 360.0 - 180.0


def _transition_turn(length, r1, r2, profile):
    if not length > 0:
        return 0.0
    return _turn(0.0, transition_end(0.0, 0.0, 0.0, length, r1, r2, profile)[2])


def _point_on_arc(p, bearing, s, signed_r):
    """Point and bearing `s` metres along an arc from `p` (negative: backwards)."""
    return _arc_forward(p[0], p[1], bearing, signed_r, s / abs(signed_r))


def _centre_of(p, bearing, signed_r):
    """Centre of the circle through `p` with tangent `bearing` and `signed_r`."""
    rad = bearing * DEG2RAD
    return (p[0] + signed_r * math.cos(rad), p[1] - signed_r * math.sin(rad))


# ── two straights: an arc in the corner ──────────────────────────────────────

def _corner(dep, arr, radius, l_dep, l_arr, profile, reverse):
    """The arc in the corner, the arrival met against its direction or with it."""
    d1 = dir_of(dep["bearing"])
    a = dir_of(arr["bearing"])
    d2 = (-a[0], -a[1]) if reverse else a
    p1 = dep["start"]
    p2 = arr["start"] if reverse else arr["end"]
    if abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9:
        raise SpliceError("splice_error_parallel")
    fit = fit_curve_group(p1, d1, p2, d2, radius, l_dep, l_arr, profile, profile)
    if fit is None:
        raise SpliceError("splice_error_clothoid_too_long")
    return fit, p1, p2, d2


def _orientations(dep, arr):
    """Both ways to meet the arrival, the smaller turn first: against its direction
    where the two oppose (a corner), with it where they agree (a continuation)."""
    d1, a = dir_of(dep["bearing"]), dir_of(arr["bearing"])
    first = d1[0] * a[0] + d1[1] * a[1] < 0
    return (first, not first)


def _fits(fit):
    return fit["entry_len"] >= -TOL and fit["exit_len"] >= -TOL


def _largest_radius(dep, arr, l_dep, l_arr, profile, upto, reverse):
    """The largest radius up to `upto` whose arc still fits on both elements, or None."""
    def fits(r):
        try:
            return _fits(_corner(dep, arr, r, l_dep, l_arr, profile, reverse)[0])
        except SpliceError:
            return False
    lo, hi = 1.0, upto
    if not fits(lo):
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        if fits(mid):
            lo = mid
        else:
            hi = mid
    return math.floor(lo)


def splice_straights(dep, arr, radius, l_dep=0.0, l_arr=0.0, profile="clothoid"):
    """An arc of `radius` in the corner of two straights, transitions optional.

    The arrival is met the way that turns less; where the arc does not fit that
    way but the other — two tracks square to each other, where "less" is a
    coin toss — the other is taken. Where it fits neither way, the answer
    names the largest radius that would, on the way that turns less.
    """
    if not radius or radius <= 0:
        raise SpliceError("splice_error_parallel")
    first_error = None
    for reverse in _orientations(dep, arr):
        try:
            fit, p1, p2, d2 = _corner(dep, arr, radius, l_dep, l_arr, profile, reverse)
        except SpliceError as exc:
            first_error = first_error or exc
            continue
        if _fits(fit):
            break
        if first_error is None:
            side = "dep" if fit["entry_len"] < -TOL else "arr"
            first_error = SpliceError(f"splice_error_{side}_too_large",
                                      rMax=_largest_radius(dep, arr, l_dep, l_arr, profile, radius, reverse))
    else:
        raise first_error
    sr = fit["signed_r"]
    exit_bearing = (math.atan2(d2[0], d2[1]) * RAD2DEG) % 360.0
    els = []
    if fit["entry_len"] > 1e-6:
        els.append(straight(p1, fit["cl_start"], "dep"))
    if l_dep > 0:
        els.append(transition(fit["cl_start"], dep["bearing"], l_dep, None, sr, profile,
                              end=fit["arc_start"], end_bearing=fit["arc_start_bearing"]))
    els.append(arc(fit["arc_start"], fit["arc_end"], sr, "new"))
    if l_arr > 0:
        els.append(transition(fit["arc_end"], fit["arc_end_bearing"], l_arr, sr, None, profile,
                              end=fit["cl_end"], end_bearing=exit_bearing))
    if fit["exit_len"] > 1e-6:
        els.append(straight(fit["cl_end"], p2, "arr"))
    return {
        "elements": els, "reverseArr": reverse,
        "info": {"arcLength": fit["arc_len"], "signedR": sr, "curveSide": fit["curve_side"]},
    }


# ── two arcs joined by a straight ────────────────────────────────────────────

def splice_arcs_straight(dep, arr, l_dep=0.0, l_arr=0.0, profile="clothoid"):
    r1s, r2s = dep["radius"], arr["radius"]
    r1, r2 = abs(r1s), abs(r2s)

    def left_normal(d):
        return (-d[1], d[0])

    d1, d2 = dir_of(dep["bearing"]), dir_of(arr["bearing"])
    sgn1 = -1.0 if r1s >= 0 else 1.0
    sgn2 = -1.0 if r2s >= 0 else 1.0
    ln1, ln2 = left_normal(d1), left_normal(d2)
    o1 = (dep["end"][0] + sgn1 * r1 * ln1[0], dep["end"][1] + sgn1 * r1 * ln1[1])
    o2 = (arr["end"][0] + sgn2 * r2 * ln2[0], arr["end"][1] + sgn2 * r2 * ln2[1])
    # Side of each centre against the straight's travel (+1 = left of it): the
    # departure arc runs forward, the arrival arc backwards.
    sig1 = 1.0 if r1s < 0 else -1.0
    sig2 = -1.0 if r2s < 0 else 1.0
    p1, t1, phi1 = transition_shift(l_dep, r1, profile)
    p2, t2, phi2 = transition_shift(l_arr, r2, profile)
    dd1, dd2 = r1 + p1, r2 + p2

    de, dn = o2[0] - o1[0], o2[1] - o1[1]
    m = math.hypot(de, dn)
    if m < 1e-6:
        raise SpliceError("splice_error_parallel")
    c = sig2 * dd2 - sig1 * dd1
    if abs(c) > m + 1e-6:
        raise SpliceError("splice_error_parallel")
    gamma = math.atan2(de, dn)
    base = math.asin(max(-1.0, min(1.0, c / m)))
    best = None
    for bm in (gamma + base, gamma + math.pi - base):
        b = (bm * RAD2DEG) % 360.0
        u = dir_of(b)
        lnu = left_normal(u)
        f1 = (o1[0] - sig1 * dd1 * lnu[0], o1[1] - sig1 * dd1 * lnu[1])
        f2 = (o2[0] - sig2 * dd2 * lnu[0], o2[1] - sig2 * dd2 * lnu[1])
        fwd = (f2[0] - f1[0]) * u[0] + (f2[1] - f1[1]) * u[1]
        if best is None or fwd > best[4]:
            best = (b, u, f1, f2, fwd)
    if best is None or best[4] <= 0:
        raise SpliceError("splice_error_parallel")
    b, u, f1, f2, _ = best
    s1 = (f1[0] + t1 * u[0], f1[1] + t1 * u[1])
    s2 = (f2[0] - t2 * u[0], f2[1] - t2 * u[1])
    straight_len = (s2[0] - s1[0]) * u[0] + (s2[1] - s1[1]) * u[1]
    if straight_len < -TOL:
        raise SpliceError("splice_error_clothoid_too_long")
    u_ang = math.atan2(u[1], u[0])
    a_dep = u_ang - sig1 * phi1
    j1 = (o1[0] - r1 * math.cos(a_dep + sig1 * math.pi / 2), o1[1] - r1 * math.sin(a_dep + sig1 * math.pi / 2))
    bearing_j1 = (90.0 - a_dep * RAD2DEG) % 360.0
    a_arr = u_ang + sig2 * phi2
    j2 = (o2[0] - r2 * math.cos(a_arr + sig2 * math.pi / 2), o2[1] - r2 * math.sin(a_arr + sig2 * math.pi / 2))

    els = [reshaped_arc(dep["start"], j1, r1s, "dep", bearing_j1, at_end=True)]
    if l_dep > 0:
        els.append(transition(j1, bearing_j1, l_dep, r1s, None, profile, end=s1, end_bearing=b))
    els.append(straight(s1, s2, "new"))
    bearing_j2 = b
    if l_arr > 0:
        els.append(transition(s2, b, l_arr, None, -r2s, profile, end=j2))
        bearing_j2 = els[-1]["endBearing"]
    els.append(reshaped_arc(j2, arr["start"], -r2s, "arr", bearing_j2, at_end=False))
    return {"elements": els, "reverseArr": True, "info": {"straightLength": straight_len}}


# ── two arcs joined directly by one transition ───────────────────────────────

def splice_arcs_transition(dep, arr, profile="clothoid"):
    """Compound or reverse curve: the transition whose end circle is the arrival circle.

    Where the transition starts on circle 1 only turns the figure about its
    centre, so the distance from that centre to the circle the transition
    osculates at its end depends on the length alone; the length solves
    d(L) = |O1 O2| on its own, and the start follows by turning the figure until
    the two centres line up.
    """
    r1 = dep["radius"]
    r2 = -arr["radius"]      # the arrival arc is run backwards
    if abs(r1 - r2) < 1e-9:
        raise SpliceError("splice_error_arcs_no_fit")
    o1 = _centre_of(dep["end"], dep["bearing"], dep["radius"])
    o2 = _centre_of(arr["end"], arr["bearing"], arr["radius"])
    target = math.hypot(o2[0] - o1[0], o2[1] - o1[1])

    def canon(length):
        if length > 0:
            e, n, b = transition_end(0.0, 0.0, 0.0, length, r1, r2, profile)
        else:
            e, n, b = 0.0, 0.0, 0.0
        c = _centre_of((e, n), b, r2)
        return (e, n), b, c, math.hypot(c[0] - r1, c[1])

    d0 = canon(0.0)[3]
    direction = math.copysign(1.0, canon(1e-3)[3] - d0) if canon(1e-3)[3] != d0 else 1.0
    if (target - d0) * direction < -1e-6:
        raise SpliceError("splice_error_arcs_no_fit")

    def reach(length):
        return (canon(length)[3] - target) * direction

    hi = max(20.0, abs(r1 - r2))
    while reach(hi) < 0 and hi < MAX_TRANSITION_LENGTH:
        hi *= 2
    if reach(hi) < 0:
        raise SpliceError("splice_error_arcs_too_far")
    lo = 0.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if reach(mid) < 0:
            lo = mid
        else:
            hi = mid
    length = (lo + hi) / 2
    if not length > 0:
        raise SpliceError("splice_error_arcs_no_fit")
    end, b_end, c, _ = canon(length)

    theta = math.atan2(o2[1] - o1[1], o2[0] - o1[0]) - math.atan2(c[1], c[0] - r1)
    ct, st = math.cos(theta), math.sin(theta)

    def place(e, n):
        return (o1[0] + (e - r1) * ct - n * st, o1[1] + (e - r1) * st + n * ct)

    def turned(bearing):
        return (bearing - theta * RAD2DEG) % 360.0

    j1, j2 = place(0.0, 0.0), place(*end)
    dep_arc = reshaped_arc(dep["start"], j1, r1, "dep", turned(0.0), at_end=True)
    tr = transition(j1, turned(0.0), length, r1, r2, profile, end=j2, end_bearing=turned(b_end))
    arr_arc = reshaped_arc(j2, arr["start"], r2, "arr", turned(b_end), at_end=False)
    return {
        "elements": [dep_arc, tr, arr_arc], "reverseArr": True,
        "info": {"transitionLength": length, "compound": (r1 > 0) == (r2 > 0)},
    }


# ── an arc and a straight, joined by a new arc ───────────────────────────────

def splice_arc_straight(dep, arr, radius, l_dep=0.0, l_arr=0.0, profile="clothoid"):
    """A new arc of `radius` between an arc and a straight, transitions optional.

    Built forwards from the station `s` on the arc where the chain leaves it:
    the straight's direction fixes the whole turn, the transitions take their
    share, which leaves the new arc's sweep and with it the chain. One
    condition remains — the far end has to land on the straight — and it is
    solved for `s` over the whole arc the element can become, for both hands of
    the new arc; the root that moves the junction least wins.
    """
    if not radius or radius <= 0:
        raise SpliceError("splice_error_parallel")
    arc_is_dep = dep["radius"] is not None
    if arc_is_dep == (arr["radius"] is not None):
        raise SpliceError("splice_error_mixed")
    # Always solved with the arc leading: read backwards, the other case is this one.
    a, b = (dep, arr) if arc_is_dep else (arr, dep)
    la, lb = (l_dep, l_arr) if arc_is_dep else (l_arr, l_dep)
    ra = a["radius"]

    exit_bearing = (b["bearing"] + 180.0) % 360.0
    exit_dir = dir_of(exit_bearing)
    normal = (-exit_dir[1], exit_dir[0])

    def build(s, rn):
        j1, b1 = _point_on_arc(a["end"], a["bearing"], s, ra)
        t_in = _transition_turn(la, ra, rn, profile)
        t_out = _transition_turn(lb, rn, None, profile)
        arc_turn = _turn(b1 + t_in + t_out, exit_bearing)
        if arc_turn == 0 or math.copysign(1.0, arc_turn) != math.copysign(1.0, rn):
            return None
        arc_len = abs(arc_turn) * DEG2RAD * radius
        if la > 0:
            e, n, _ = transition_end(j1[0], j1[1], b1, la, ra, rn, profile)
            a1 = (e, n)
        else:
            a1 = j1
        ba1 = b1 + t_in
        a2, ba2 = _arc_forward(a1[0], a1[1], ba1, rn, arc_len / radius)
        if lb > 0:
            e, n, _ = transition_end(a2[0], a2[1], ba2, lb, rn, None, profile)
            end = (e, n)
        else:
            end = a2
        residual = (end[0] - b["end"][0]) * normal[0] + (end[1] - b["end"][1]) * normal[1]
        return {"j1": j1, "b1": b1, "a1": a1, "ba1": ba1, "a2": a2, "ba2": ba2, "end": end,
                "arc_len": arc_len, "residual": residual}

    # How far the junction may move along the arc: back to its start, or on
    # until the element would be half a circle.
    centre = arc_center(a["start"][0], a["start"][1], a["end"][0], a["end"][1], ra)
    len_a = abs(arc_sweep(a["start"][0], a["start"][1], a["end"][0], a["end"][1], centre[0], centre[1], ra)) * abs(ra) \
        if centre else 0.0
    s_min, s_max = -len_a, math.pi * abs(ra) - len_a

    def f(s, rn):
        built = build(s, rn)
        return built["residual"] if built else float("nan")

    chosen = None
    for rn in (radius, -radius):
        n = ARC_STRAIGHT_SAMPLES
        xs = [s_min + (s_max - s_min) * i / n for i in range(n + 1)]
        ys = [f(x, rn) for x in xs]
        for i in range(n):
            y0, y1 = ys[i], ys[i + 1]
            if not (math.isfinite(y0) and math.isfinite(y1)) or y0 * y1 > 0:
                continue
            lo, hi, flo = xs[i], xs[i + 1], y0
            for _ in range(80):
                mid = (lo + hi) / 2
                fm = f(mid, rn)
                if not math.isfinite(fm):
                    break
                if flo * fm <= 0:
                    hi = mid
                else:
                    lo, flo = mid, fm
            s = (lo + hi) / 2
            built = build(s, rn)
            if not built or abs(built["residual"]) > 1e-4:
                continue
            # The re-shaped straight must not run past its far end.
            along = (built["end"][0] - b["start"][0]) * exit_dir[0] + (built["end"][1] - b["start"][1]) * exit_dir[1]
            if along > TOL:
                continue
            if chosen is None or abs(s) < abs(chosen[1]):
                chosen = (rn, s, built)
    if chosen is None:
        raise SpliceError("splice_error_no_fit")
    rn, _, c = chosen
    role_a, role_b = ("dep", "arr") if arc_is_dep else ("arr", "dep")
    els = []
    if math.hypot(c["j1"][0] - a["start"][0], c["j1"][1] - a["start"][1]) > 1e-6:
        els.append(reshaped_arc(a["start"], c["j1"], ra, role_a, c["b1"], at_end=True))
    if la > 0:
        els.append(transition(c["j1"], c["b1"], la, ra, rn, profile, end=c["a1"]))
    els.append(arc(c["a1"], c["a2"], rn, "new"))
    if lb > 0:
        els.append(transition(c["a2"], c["ba2"], lb, rn, None, profile, end=c["end"]))
    if math.hypot(b["start"][0] - c["end"][0], b["start"][1] - c["end"][1]) > 1e-6:
        els.append(straight(c["end"], b["start"], role_b))
    if not arc_is_dep:
        # Solved read backwards: the chain, and the hand of the new arc, turned round.
        els = [reversed_element(el) for el in reversed(els)]
        rn = -rn
    return {"elements": els, "reverseArr": True, "info": {"arcLength": c["arc_len"], "signedR": rn}}


# ── the request ──────────────────────────────────────────────────────────────

def _pick(raw):
    if not isinstance(raw, dict):
        raise ValueError("pick")
    start, end = raw.get("start"), raw.get("end")
    if not (isinstance(start, (list, tuple)) and isinstance(end, (list, tuple)) and len(start) == 2 and len(end) == 2):
        raise ValueError("pick ends")
    radius = raw.get("radius")
    return {
        "start": (float(start[0]), float(start[1])), "end": (float(end[0]), float(end[1])),
        "bearing": float(raw["bearing"]),
        "radius": float(radius) if radius not in (None, 0) else None,
        # The cant the picked element carries, a magnitude [mm] — only read for the spacing.
        "cant": abs(float(raw.get("cant") or 0)),
    }


def _start_bearing(p):
    """The bearing at a pick's start, in its own direction."""
    if p["radius"] is None:
        return p["bearing"]
    r = p["radius"]
    centre = _centre_of(p["end"], p["bearing"], r)
    v = (centre[0] - p["start"][0], centre[1] - p["start"][1])
    # The centre lies `r` to the right of the tangent: (cos b, -sin b) · r.
    return (math.atan2(-v[1] / r, v[0] / r) * RAD2DEG) % 360.0


def _flipped(p):
    """The pick run the other way. The arc constructions meet the arrival at its
    end and traverse it backwards; handed the arrival flipped, they meet it at
    its start and run it on in its own direction — a continuation."""
    return {
        **p, "start": p["end"], "end": p["start"],
        "bearing": (_start_bearing(p) + 180.0) % 360.0,
        "radius": -p["radius"] if p["radius"] is not None else None,
    }


def _construct(dep, arr, radius, l_dep, l_arr, profile, arc_join):
    """The splice of the case the two picks make (raises SpliceError)."""
    if dep["radius"] is None and arr["radius"] is None:
        return splice_straights(dep, arr, radius, l_dep, l_arr, profile)
    if dep["radius"] is not None and arr["radius"] is not None:
        if arc_join == "transition":
            def build(d, a):
                return splice_arcs_transition(d, a, profile)
        else:
            def build(d, a):
                return splice_arcs_straight(d, a, l_dep, l_arr, profile)
    else:
        def build(d, a):
            return splice_arc_straight(d, a, radius, l_dep, l_arr, profile)
    # The arrival is joined at its end nearer the departure: its end — a corner,
    # traversed backwards — or its start, a continuation run on as it is.
    reverse = math.dist(dep["end"], arr["end"]) < math.dist(dep["end"], arr["start"])
    res = build(dep, arr if reverse else _flipped(arr))
    res["reverseArr"] = reverse
    return res


def _with_clearance(dep, arr, radius, l_dep, l_arr, profile, arc_join, cl):
    """The splice held to a spacing to a neighbouring track (see clearance.py):
    checked at `radius`, or with `maximize` the largest radius that keeps it —
    where the case has a radius of its own to choose (not two arcs)."""
    d_min = float(cl["dMin"])
    if not d_min > 0:
        raise ValueError("dMin")
    spacing = Spacing(cl["profile"])
    es = [p[0] for p in (dep["start"], dep["end"], arr["start"], arr["end"])]
    ns = [p[1] for p in (dep["start"], dep["end"], arr["start"], arr["end"])]
    neighbour = Neighbour(cl.get("ref") or [], (min(es), min(ns), max(es), max(ns)))
    speed = float(cl.get("speed") or 0)
    model = cl.get("cantModel") or {}

    def cant_of(u_new):
        def of(el):
            sign = 1.0 if el["radius"] > 0 else -1.0
            role = el.get("role", "new")
            return sign * (dep["cant"] if role == "dep" else arr["cant"] if role == "arr" else u_new)
        return of

    def described(res, u_new, extra):
        worst = check(res["elements"], neighbour, spacing, d_min, cant_of(u_new))
        info = {"dMin": d_min, "near": worst is not None, **extra}
        if worst is not None:
            info.update(worst)
            info["kept"] = worst["margin"] >= -1e-6
        else:
            info["kept"] = True
        return info

    free = not (dep["radius"] is not None and arr["radius"] is not None)
    if cl.get("maximize") and free:
        r_max = clearance.R_MAX
        try:
            _construct(dep, arr, r_max, l_dep, l_arr, profile, arc_join)
        except SpliceError as exc:
            # Too large to fit on the elements at all: the search starts where it fits.
            if exc.params.get("rMax"):
                r_max = float(exc.params["rMax"])

        # The arc inserted has to be an element of its own length: between an
        # arc and a straight the old arc can otherwise be run on round to the
        # straight, and the "largest radius" is a sliver of any radius at all.
        l_min = float(cl.get("lMin") or 0)

        def build(r):
            try:
                res = _construct(dep, arr, r, l_dep, l_arr, profile, arc_join)
            except SpliceError:
                return None
            if res["info"].get("arcLength", 0) < l_min:
                return None
            u = auto_cant(speed, r, model)
            res["clearance"] = described(res, u, {"cant": u})
            return res

        r, res = largest_radius(build, lambda res: res["clearance"]["kept"], r_max=r_max)
        if r is None:
            raise SpliceError("splice_error_clearance", dMin=d_min)
        res["info"]["clearance"] = {**res.pop("clearance"), "radius": r, "maximized": True}
        return res

    res = _construct(dep, arr, radius, l_dep, l_arr, profile, arc_join)
    res["info"]["clearance"] = described(res, abs(float(cl.get("cant") or 0)), {})
    return res


def splice_payload(payload):
    """The answer to `POST /splice`.

    Body: {"dep": pick, "arr": pick, "radius": m, "lDep": m, "lArr": m,
           "transition": "clothoid"|"bloss", "arcJoin": "straight"|"transition",
           "clearance": optional, see below}
    with a pick {"start": [e, n], "end": [e, n], "bearing": deg at the end,
    "radius": signed m or null, "cant": mm}. Answers {"elements", "reverseArr",
    "info"} or {"error": key, "params": {...}} for a splice that does not fit.
    A body that is not one raises ValueError.

    `clearance` holds the splice to a spacing to another track (clearance.py):
    {"ref": [[e, n, cant], …] its axis in this plane, "dMin": m, "profile":
    [[y, z], …] the half clearance outline in mm, "cant": mm on the new arc,
    "maximize": bool, "speed": km/h and "cantModel": {coeff, defCoeff, defMin,
    max, step} for the cant at each radius tried, "lMin": m the shortest arc
    the search may insert (LP.EL.01 at that speed)}. The answer's info then
    carries `clearance`: dMin, kept, near and — where the neighbour lies near —
    margin, distance, required, cantNew, cantRef, at, ref; with `maximize` also
    radius and cant. No radius that keeps it is the error
    `splice_error_clearance`.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload")
    dep, arr = _pick(payload.get("dep")), _pick(payload.get("arr"))
    radius = float(payload.get("radius") or 0)
    l_dep = max(0.0, float(payload.get("lDep") or 0))
    l_arr = max(0.0, float(payload.get("lArr") or 0))
    profile = payload.get("transition", "clothoid")
    if profile not in ("clothoid", "bloss"):
        raise ValueError("transition")
    arc_join = payload.get("arcJoin")
    cl = payload.get("clearance")
    if cl is not None and not isinstance(cl, dict):
        raise ValueError("clearance")
    try:
        if cl:
            return _with_clearance(dep, arr, radius, l_dep, l_arr, profile, arc_join, cl)
        return _construct(dep, arr, radius, l_dep, l_arr, profile, arc_join)
    except SpliceError as exc:
        return {"error": exc.code, "params": exc.params}
