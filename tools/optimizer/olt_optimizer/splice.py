"""Splicing two elements into one chain — the construction of "Elemente verbinden".

Since AP 12.4 this is the only implementation: the panel asks the service
(`POST /splice`), and the alignment fit from measured axis points (phase 12)
builds its arcs with the same functions. It replaces the app's former
src/utils/spliceUtils.js.

The two picked elements come in the plane of their track (one CRS for both):
each with its two ends, the bearing at its end in the element's own direction
and its signed radius (None for a straight). Which ends meet is the service's
to find, not the order of the clicks (Paket S, AP S.2): each pick can be
joined at either end, which makes four pairs of ends, and every one is
constructed. Each construction runs the departure into the splice and meets
the arrival at its end, traversing it backwards; a pick joined at its other
end is handed over flipped (`_flipped`). What comes back is every pair that
fits, the best first (`_rank`); the panel proposes that one and lets the
others be chosen (Entscheidung 180). Each is judged as a whole by the rule
catalogue (`_judge`, AP S.4) — what is left of the two picks, what is
inserted and the joints — and an error there holds the panel's commit back.

A solution is the chain from the departure's far end to the arrival's far
end, in travel order, every element in the app's plane form (startNode,
endNode, bearing, endBearing, length, radius / r1 r2) and with a `role`:
'dep' and 'arr' for what is left of the two picked elements, re-shaped, 'new'
for what the splice inserts. Which pick departs and whether either is run
against its own direction it says itself (`depPick`, `reverseDep`,
`reverseArr`). Each element carries the design speed and cant it will have
(`_annotate`), and the transitions it inserts are as long as their mode asks
(`_solve`, AP S.3): as given, or the Regellänge or Mindestlänge between their
neighbours in the very chain solved.

Conventions are the geometry kernel's: bearings in degrees clockwise from grid
north, signed radius > 0 for a right-hand curve.
"""

import functools
import math

import numpy as np

from . import clearance
from .clearance import Neighbour, Spacing, auto_cant, check, largest_radius
from .grenzen import transition_lengths
from .pruefung import check_track
from .regelwerk import load_katalog
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


def _transition_shape(length, r1, r2, profile):
    """A transition laid from the origin heading east: (Δe, Δn, turn in degrees)
    — where it ends, turned with any other start bearing (`_placed`)."""
    if not length > 0:
        return (0.0, 0.0, 0.0)
    e, n, b = transition_end(0.0, 0.0, 90.0, length, r1, r2, profile)
    return (e, n, _turn(90.0, b))


def _placed(p, bearing, shape):
    """Where a transition of `shape` ends that starts at `p` heading `bearing`."""
    phi = (90.0 - bearing) * DEG2RAD
    c, s = math.cos(phi), math.sin(phi)
    return (p[0] + shape[0] * c - shape[1] * s, p[1] + shape[0] * s + shape[1] * c)


def _point_on_arc(p, bearing, s, signed_r):
    """Point and bearing `s` metres along an arc from `p` (negative: backwards)."""
    return _arc_forward(p[0], p[1], bearing, signed_r, s / abs(signed_r))


def _centre_of(p, bearing, signed_r):
    """Centre of the circle through `p` with tangent `bearing` and `signed_r`."""
    rad = bearing * DEG2RAD
    return (p[0] + signed_r * math.cos(rad), p[1] - signed_r * math.sin(rad))


# ── two straights: an arc in the corner ──────────────────────────────────────

def _corner(dep, arr, radius, l_dep, l_arr, profile):
    """The arc in the corner, the arrival met at its end and run back from there."""
    d1 = dir_of(dep["bearing"])
    a = dir_of(arr["bearing"])
    d2 = (-a[0], -a[1])
    p1 = dep["start"]
    p2 = arr["start"]
    if abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9:
        raise SpliceError("splice_error_parallel")
    fit = fit_curve_group(p1, d1, p2, d2, radius, l_dep, l_arr, profile, profile)
    if fit is None:
        raise SpliceError("splice_error_clothoid_too_long")
    return fit, p1, p2, d2


def _fits(fit):
    return fit["entry_len"] >= -TOL and fit["exit_len"] >= -TOL


def _largest_radius(dep, arr, l_dep, l_arr, profile, upto):
    """The largest radius up to `upto` whose arc still fits on both elements, or None."""
    def fits(r):
        try:
            return _fits(_corner(dep, arr, r, l_dep, l_arr, profile)[0])
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
    """An arc of `radius` in the corner of two straights, transitions optional,
    the arrival met at its end. Where the arc does not fit on the two, the
    answer names the largest radius that would."""
    if not radius or radius <= 0:
        raise SpliceError("splice_error_parallel")
    fit, p1, p2, d2 = _corner(dep, arr, radius, l_dep, l_arr, profile)
    if not _fits(fit):
        side = "dep" if fit["entry_len"] < -TOL else "arr"
        raise SpliceError(f"splice_error_{side}_too_large",
                          rMax=_largest_radius(dep, arr, l_dep, l_arr, profile, radius))
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
    return {"elements": els, "info": {"arcLength": fit["arc_len"], "signedR": sr}}


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
    return {"elements": els, "info": {"straightLength": straight_len}}


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
        "elements": [dep_arc, tr, arr_arc],
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

    # The two transitions do not change with where they start, only turn with
    # it: worked out once per hand of the new arc (the search asks thousands of times).
    shapes = {rn: (_transition_shape(la, ra, rn, profile), _transition_shape(lb, rn, None, profile))
              for rn in (radius, -radius)}

    def build(s, rn):
        j1, b1 = _point_on_arc(a["end"], a["bearing"], s, ra)
        shape_in, shape_out = shapes[rn]
        t_in, t_out = shape_in[2], shape_out[2]
        arc_turn = _turn(b1 + t_in + t_out, exit_bearing)
        if arc_turn == 0 or math.copysign(1.0, arc_turn) != math.copysign(1.0, rn):
            return None
        arc_len = abs(arc_turn) * DEG2RAD * radius
        a1 = _placed(j1, b1, shape_in)
        ba1 = b1 + t_in
        a2, ba2 = _arc_forward(a1[0], a1[1], ba1, rn, arc_len / radius)
        end = _placed(a2, ba2, shape_out)
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

    def sampled(xs, rn):
        """f at every station of `xs` at once — build() in numpy, for the scan."""
        side_a, side_n = (1.0 if ra >= 0 else -1.0), (1.0 if rn >= 0 else -1.0)
        shape_in, shape_out = shapes[rn]
        b0 = a["bearing"] * DEG2RAD
        cx = a["end"][0] + side_a * abs(ra) * math.cos(b0)
        cy = a["end"][1] - side_a * abs(ra) * math.sin(b0)
        rx, ry = a["end"][0] - cx, a["end"][1] - cy
        ang = -side_a * xs / abs(ra)
        j1 = (cx + rx * np.cos(ang) - ry * np.sin(ang), cy + rx * np.sin(ang) + ry * np.cos(ang))
        b1 = np.mod(a["bearing"] - ang * RAD2DEG, 360.0)
        arc_turn = np.mod(np.mod(exit_bearing - (b1 + shape_in[2] + shape_out[2]) + 180.0, 360.0) + 360.0, 360.0) - 180.0
        valid = (arc_turn != 0) & (np.sign(arc_turn) == side_n)
        sweep = np.abs(arc_turn) * DEG2RAD

        def placed(p, bearing, shape):
            phi = (90.0 - bearing) * DEG2RAD
            return (p[0] + shape[0] * np.cos(phi) - shape[1] * np.sin(phi),
                    p[1] + shape[0] * np.sin(phi) + shape[1] * np.cos(phi))
        a1 = placed(j1, b1, shape_in)
        ba1 = (b1 + shape_in[2]) * DEG2RAD
        ccx, ccy = a1[0] + side_n * radius * np.cos(ba1), a1[1] - side_n * radius * np.sin(ba1)
        qx, qy = a1[0] - ccx, a1[1] - ccy
        turn = -side_n * sweep
        a2 = (ccx + qx * np.cos(turn) - qy * np.sin(turn), ccy + qx * np.sin(turn) + qy * np.cos(turn))
        end = placed(a2, b1 + shape_in[2] + side_n * sweep * RAD2DEG, shape_out)
        res = (end[0] - b["end"][0]) * normal[0] + (end[1] - b["end"][1]) * normal[1]
        return np.where(valid, res, np.nan)

    chosen = None
    for rn in (radius, -radius):
        n = ARC_STRAIGHT_SAMPLES
        xs = [s_min + (s_max - s_min) * i / n for i in range(n + 1)]
        ys = sampled(np.array(xs), rn).tolist()
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
    return {"elements": els, "info": {"arcLength": c["arc_len"], "signedR": rn}}


# ── the picks ────────────────────────────────────────────────────────────────

def _point(raw, key):
    v = raw.get(key)
    if not (isinstance(v, (list, tuple)) and len(v) == 2):
        raise ValueError(f"pick {key}")
    return (float(v[0]), float(v[1]))


def _pick(raw):
    if not isinstance(raw, dict):
        raise ValueError("pick")
    radius = raw.get("radius")
    p = {
        "start": _point(raw, "start"), "end": _point(raw, "end"),
        "bearing": float(raw["bearing"]),
        "radius": float(radius) if radius not in (None, 0) else None,
        # The cant the picked element carries, a magnitude [mm], and its design speed.
        "cant": abs(float(raw.get("cant") or 0)),
        "speed": max(0.0, float(raw.get("speed") or 0)),
        # How much of its track lies before and after the element [m]: what
        # joining it at the one or the other end gives up (`_cost`).
        "before": max(0.0, float(raw.get("before") or 0)),
        "after": max(0.0, float(raw.get("after") or 0)),
    }
    p["length"] = float(raw["length"]) if raw.get("length") else _length_of(p)
    return p


def _start_bearing(p):
    """The bearing at a pick's start, in its own direction."""
    if p["radius"] is None:
        return p["bearing"]
    r = p["radius"]
    centre = _centre_of(p["end"], p["bearing"], r)
    v = (centre[0] - p["start"][0], centre[1] - p["start"][1])
    # The centre lies `r` to the right of the tangent: (cos b, -sin b) · r.
    return (math.atan2(-v[1] / r, v[0] / r) * RAD2DEG) % 360.0


def _length_of(p):
    """A pick's length where the request does not give it: its chord, or its arc."""
    if p["radius"] is None:
        return math.dist(p["start"], p["end"])
    sweep = ((p["bearing"] - _start_bearing(p)) * math.copysign(1.0, p["radius"])) % 360.0
    return sweep * DEG2RAD * abs(p["radius"])


def _flipped(p):
    """The pick run the other way. The constructions run the departure into the
    splice at its end and meet the arrival at its end, traversing it backwards;
    a pick joined at its start is handed over flipped."""
    return {
        **p, "start": p["end"], "end": p["start"],
        "bearing": (_start_bearing(p) + 180.0) % 360.0,
        "radius": -p["radius"] if p["radius"] is not None else None,
        "before": p["after"], "after": p["before"],
    }


def _toward(p, end):
    """The pick as a construction takes it, joined at its `end` ('start' | 'end')."""
    return p if end == "end" else _flipped(p)


def _track_length(p):
    return p["before"] + p["length"] + p["after"]


def _key(p):
    """An order of two picks that neither the clicks nor the direction a track
    is stored in can change: by the lower of their two ends."""
    return min(tuple(round(c, 3) for c in p["start"]), tuple(round(c, 3) for c in p["end"]))


# ── the constructions, and which ends meet ───────────────────────────────────

def _construct(dep, arr, radius, l_dep, l_arr, profile, arc_join):
    """The splice of the case the two picks make, the departure run into it at
    its end and the arrival met at its end (raises SpliceError)."""
    if dep["radius"] is None and arr["radius"] is None:
        return splice_straights(dep, arr, radius, l_dep, l_arr, profile)
    if dep["radius"] is not None and arr["radius"] is not None:
        if arc_join == "transition":
            return splice_arcs_transition(dep, arr, profile)
        return splice_arcs_straight(dep, arr, l_dep, l_arr, profile)
    return splice_arc_straight(dep, arr, radius, l_dep, l_arr, profile)


# How a transition beside a pick gets its length: as given, or the shortest the
# rules allow at their Regelwert or down to their Ermessensgrenze (Entscheidung 176).
LENGTH_MODES = ("fixed", "regular", "minimum")

# The four pairs of ends two picks can meet at: (the first pick's, the second's).
PAIRS = (("end", "start"), ("start", "end"), ("end", "end"), ("start", "start"))


def _departure(picks, ends):
    """Which pick departs where `ends` meet. An end meeting a start leaves the
    tracks as they run. Two ends or two starts turn one track round, and that
    is the shorter of the two (Entscheidung 182): two ends meet with the longer
    departing, two starts with the shorter departing backwards. Equally long,
    the second pick is the one turned."""
    if ends[0] != ends[1]:
        return 0 if ends[0] == "end" else 1
    l0, l1 = _track_length(picks[0]), _track_length(picks[1])
    if abs(l0 - l1) < 1e-6:
        return 0 if ends[0] == "end" else 1
    longer = 0 if l0 > l1 else 1
    return longer if ends[0] == "end" else 1 - longer


def _swap_side(code):
    return code.replace("_dep_", "_tmp_").replace("_arr_", "_dep_").replace("_tmp_", "_arr_")


def _reversed(res):
    """A construction read the other way: the chain turned round, departure and arrival swapped."""
    swap = {"dep": "arr", "arr": "dep"}
    els = []
    for el in reversed(res["elements"]):
        out = reversed_element(el)
        out["role"] = swap.get(el["role"], el["role"])
        els.append(out)
    info = dict(res["info"])
    if info.get("signedR") is not None:
        info["signedR"] = -info["signedR"]
    return {**res, "elements": els, "info": info}


def _pair(picks, ends, spec, lengths):
    """The splice where `ends` meet with the transitions `lengths` beside the
    two picks, as a solution (raises SpliceError).

    Constructed from the pick `_key` puts first, so that the clicks cannot
    change what is found, and read the way `_departure` says."""
    c = 0 if _key(picks[0]) <= _key(picks[1]) else 1
    if ends[c] != ends[1 - c] and ends[c] == "start":
        c = 1 - c                      # an end meeting a start departs from the end
    d = _departure(picks, ends)
    try:
        res = _construct(_toward(picks[c], ends[c]), _toward(picks[1 - c], ends[1 - c]),
                         spec["radius"], lengths[c], lengths[1 - c], spec["profile"], spec["arcJoin"])
    except SpliceError as exc:
        if c != d:
            exc.code = _swap_side(exc.code)
        raise
    if c != d:
        res = _reversed(res)
    res.update({"depPick": d, "ends": list(ends),
                "reverseDep": ends[d] == "start", "reverseArr": ends[1 - d] == "end"})
    _annotate(res, picks, spec)
    return res


def _annotate(sol, picks, spec):
    """Each element's design speed and cant, as the app will write them: what
    is left of a picked element keeps its own, what the splice inserts takes
    the dialog's speed, and an inserted arc the dialog's cant — each signed
    with its curve. A transition's cant is its neighbours' (pruefung)."""
    d = sol["depPick"]
    for el in sol["elements"]:
        role = el["role"]
        own = picks[d] if role == "dep" else picks[1 - d] if role == "arr" else None
        el["speed"] = own["speed"] if own else spec["speed"]
        if el["elementType"] == 1:
            el["cant"] = math.copysign(own["cant"] if own else spec["cant"], el["radius"])
        elif el["elementType"] == 0:
            el["cant"] = 0.0


def _sides(sol):
    """The transitions a solution inserts, by the pick they stand beside:
    {pick index: element index}. Those before the inserted arc or straight
    stand beside the departure, those after it beside the arrival; a single
    transition from arc to arc stands beside neither — its length is the
    construction's."""
    els = sol["elements"]
    body = [i for i, el in enumerate(els) if el["role"] == "new" and el["elementType"] != 2]
    if not body:
        return {}
    d = sol["depPick"]
    out = {}
    for i, el in enumerate(els):
        if el["role"] == "new" and el["elementType"] == 2:
            out[d if i < body[0] else 1 - d] = i
    return out


def _side_rules(sol, spec):
    """The shortest lengths the rules allow for each transition the solution
    inserts, between its neighbours there (grenzen.transition_lengths):
    {pick index: {regular, minimum, regularBy, minimumBy}}."""
    els = sol["elements"]
    out = {}
    for k, i in _sides(sol).items():
        out[k] = transition_lengths(els[i - 1] if i else None, els[i + 1] if i + 1 < len(els) else None,
                                    els[i].get("r1"), spec["profile"], spec["speed"])
    return out


# How often the lengths are set from the chain they stand in and the chain
# built again with them: a compound or reverse curve, and with it Δu and Δu_f,
# is the construction's answer, so the two are solved together (Paket S, AP S.3).
MAX_ROUNDS = 8


def _solve(picks, ends, spec):
    """The splice where `ends` meet, the transitions each as long as its mode
    asks (Entscheidung 179): 'fixed' as given, 'regular' or 'minimum' the
    Regellänge or Mindestlänge between its neighbours in the very chain it
    stands in. Built, the lengths read off, built again with them, until they
    stand (raises SpliceError). Without a design speed the rules say nothing,
    and a side keeps the length given.

    The solution says for each pick what its transition is: {mode, length}
    and the rules on it (regular, minimum, regularBy, minimumBy)."""
    modes = spec["modes"]
    cur = list(spec["lengths"])
    for _ in range(MAX_ROUNDS):
        sol = _pair(picks, ends, spec, cur)
        rules = _side_rules(sol, spec)
        want = list(cur)
        for k in (0, 1):
            ask = modes[k]
            if ask in ("regular", "minimum") and rules.get(k, {}).get(ask) is not None and cur[k] > 0:
                want[k] = rules[k][ask]
        if all(abs(a - b) < 1e-9 for a, b in zip(want, cur)):
            break
        cur = want
    else:
        raise SpliceError("splice_error_lengths_unstable")
    _continuous(sol["elements"])
    sol["lengths"] = [
        {"mode": modes[k] if k in rules else "fixed", "length": cur[k] if k in rules else 0.0, **rules.get(k, {})}
        for k in (0, 1)
    ]
    return sol


def _cost(sol, picks):
    """How much a solution rebuilds [m]: the track it gives up beyond the ends
    that meet, how far it re-shapes the two picked elements, and the new
    stretch it inserts."""
    d = sol["depPick"]
    cost = 0.0
    for i, role in ((d, "dep"), (1 - d, "arr")):
        p = picks[i]
        cost += p["after"] if sol["ends"][i] == "end" else p["before"]
        kept = sum(el["length"] for el in sol["elements"] if el["role"] == role)
        cost += abs(kept - p["length"])
    return cost + sum(el["length"] for el in sol["elements"] if el["role"] == "new")


def _element_turn(el):
    """How far an element turns [rad], signed (right > 0)."""
    if el["elementType"] == 1:
        return el["length"] / el["radius"]
    if el["elementType"] == 2:
        return _turn(el["bearing"], el["endBearing"]) * DEG2RAD
    return 0.0


def _loops(sol, picks):
    """Does a solution turn by more than half a circle beyond what the two
    picked elements turned already — run round in a loop to reach an end
    that faces away? No track is joined that way; such a pair is dropped."""
    d = sol["depPick"]
    own = 0.0
    for i, flip in ((d, sol["reverseDep"]), (1 - d, sol["reverseArr"])):
        r = picks[i]["radius"]
        if r is not None:
            own += picks[i]["length"] / (-r if flip else r)
    return abs(sum(_element_turn(el) for el in sol["elements"]) - own) > math.pi + 1e-6


@functools.lru_cache(maxsize=None)
def _katalog():
    return load_katalog()


def _judge(sol):
    """What the catalogue finds on the whole stretch a solution writes — the
    rest of the departure, what is inserted, the rest of the arrival and the
    joints between them (Paket S, AP S.4) — with the speed and cant each
    element will carry. `findings`: every result worse than ok, as {at, index,
    id, severity} — `at` '#i' for an element, '#i|#j' for a joint, `index` the
    elements it is about; `worst` the worst severity among them, 'ok' where
    nothing is found. An element without a design speed is not judged."""
    k = _katalog()
    findings = []
    for where, rid, severity in check_track(k, sol["elements"]):
        if k.rank(severity) <= k.rank("ok"):
            continue
        findings.append({"at": where, "index": [int(x[1:]) for x in where.split("|")],
                         "id": rid, "severity": severity})
    sol["findings"] = findings
    sol["worst"] = max((f["severity"] for f in findings), key=k.rank, default="ok")
    sol["judged"] = any(el.get("speed") for el in sol["elements"])


def _rank(sol):
    """Best first: what the catalogue finds — nothing before a hint before a
    warning, and so on up to an error — then the way of joining asked for
    before the other, then little rebuilt and a short new stretch."""
    return (_katalog().rank(sol["worst"]), sol.get("alternative", False), round(sol["rebuilt"], 6))


# How far two elements may part or kink at a junction and still be one chain
# [m, degrees] — the rounding of the constructions, nothing a track could show.
JOIN_GAP = 1e-4
JOIN_KINK = 1e-4


def _continuous(els):
    """Is the chain one line — no gap, no kink, and every transition meeting
    the curvature of its neighbours? A hard condition, not a rule: a chain
    that breaks it is not a solution (raises SpliceError)."""
    def k(r):
        return 1.0 / r if r else 0.0

    def k_end(el):
        return k(el.get("r2")) if el["elementType"] == 2 else k(el.get("radius"))

    def k_start(el):
        return k(el.get("r1")) if el["elementType"] == 2 else k(el.get("radius"))
    for a, b in zip(els, els[1:]):
        if math.dist(a["endNode"], b["startNode"]) > JOIN_GAP \
                or abs(_turn(a.get("endBearing", a["bearing"]), b["bearing"])) > JOIN_KINK \
                or (2 in (a["elementType"], b["elementType"]) and abs(k_end(a) - k_start(b)) > 1e-9):
            raise SpliceError("splice_error_discontinuous")


def _gap(picks, ends):
    return math.dist(picks[0][ends[0]], picks[1][ends[1]])


# Where the request has no transitions to offer an alternative with, two arcs
# joined over a straight get them at the Regellänge, the search starting here [m].
ALTERNATIVE_START = 60.0


def _joins(picks, spec):
    """The ways to try, the one asked for first: for two arcs also the other
    way to join them — over a straight where one transition was asked for and
    the reverse (Entscheidung 180, AP S.5). The straight comes with the
    transitions asked for, and where none were, with transitions at the
    Regellänge — two canted arcs need their ramps; without a design speed
    there is no Regellänge, and none (Entscheidung 183)."""
    if picks[0]["radius"] is None or picks[1]["radius"] is None:
        return [spec]
    other = {**spec, "arcJoin": "straight" if spec["arcJoin"] == "transition" else "transition"}
    if other["arcJoin"] == "straight" and not any(spec["lengths"]) and spec["speed"] > 0:
        other.update(lengths=[ALTERNATIVE_START, ALTERNATIVE_START], modes=["regular", "regular"])
    return [spec, other]


def _solutions(picks, spec, build=None):
    """Every pair of ends that can be joined, as {"solutions": [...]}, the best
    first — for two arcs both ways to join them (`_joins`) — or SpliceError
    for the pair whose ends lie closest, where none can, with what would fit
    (`_explain`). Where only the other way of joining two arcs fits, the
    answer says why the way asked for does not (`requested`: {error,
    params}). `build(picks, ends, spec)` replaces the plain construction (the
    spacing)."""
    build = build or _solve
    two_arcs = picks[0]["radius"] is not None and picks[1]["radius"] is not None
    found, errors = [], []
    for k, sp in enumerate(_joins(picks, spec)):
        for ends in PAIRS:
            try:
                sol = build(picks, ends, sp)
            except SpliceError as exc:
                if k == 0:
                    errors.append((_gap(picks, ends), ends, exc))
                continue
            if sol is None or _loops(sol, picks):
                continue
            sol["rebuilt"] = _cost(sol, picks)
            sol["alternative"] = k > 0
            if two_arcs:
                sol["arcJoin"] = sp["arcJoin"]
            _judge(sol)
            found.append(sol)
    if not found and not errors:
        raise SpliceError("splice_error_no_fit")
    out = {"solutions": sorted(found, key=_rank)}
    if not any(not sol["alternative"] for sol in found):
        # Nothing the way asked for: why, and what would fit — the error
        # itself, or beside the other way of joining that does.
        _, ends, exc = min(errors, key=lambda e: e[0])
        _explain(picks, ends, spec, exc)
        if not found:
            raise exc
        out["requested"] = {"error": exc.code, "params": exc.params}
    return out


# The radius search of `_explain`: down from the radius asked for in steps of
# this ratio, no further than this, then halved to the metre.
EXPLAIN_RATIO = 0.9
EXPLAIN_R_MIN = 50.0


def _explain(picks, ends, spec, exc):
    """What would fit where `ends` do not (AP S.5), into the error's params:
    `rMax` the largest radius up to the one asked for that does and, between
    an arc and a straight, `rMin` the smallest above it — where the case has a
    radius to choose — and `lMax` the longest transitions, as long on both
    sides, that do at the radius asked for — where shorter ones fit at all.
    Two straights name `rMax` themselves (splice_straights)."""
    if exc.code in ("splice_error_clearance", "splice_error_discontinuous"):
        return

    def fits(sp, lengths=None):
        try:
            if lengths is None:
                _solve(picks, ends, sp)
            else:
                _pair(picks, ends, sp, lengths)
            return True
        except SpliceError:
            return False

    def bounded(r, failed):
        """Halved to the metre between a radius that fits and one that does not."""
        lo, hi = r, failed
        while abs(hi - lo) > 0.5:
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if fits({**spec, "radius": mid}) else (lo, mid)
        return math.floor(lo) if lo < hi else math.ceil(lo)

    free = picks[0]["radius"] is None or picks[1]["radius"] is None
    if free and spec["radius"] > 0 and exc.params.get("rMax") is None:
        # Between an arc and a straight a radius can be too small as much as
        # too large: the nearest that fits either way.
        failed, r = spec["radius"], spec["radius"] * EXPLAIN_RATIO
        while r >= EXPLAIN_R_MIN and not fits({**spec, "radius": r}):
            failed, r = r, r * EXPLAIN_RATIO
        if r >= EXPLAIN_R_MIN:
            exc.params["rMax"] = bounded(r, failed)
        if picks[0]["radius"] is not None or picks[1]["radius"] is not None:
            failed, r = spec["radius"], spec["radius"] / EXPLAIN_RATIO
            while r <= clearance.R_MAX and not fits({**spec, "radius": r}):
                failed, r = r, r / EXPLAIN_RATIO
            if r <= clearance.R_MAX:
                exc.params["rMin"] = bounded(r, failed)
    sides = [k for k in (0, 1) if spec["lengths"][k] > 0]
    direct = not free and spec["arcJoin"] == "transition"
    if sides and not direct:
        def at(length):
            return [length if k in sides else 0.0 for k in (0, 1)]
        if fits(spec, at(0.0)) and not fits(spec, at(max(spec["lengths"]))):
            lo, hi = 0.0, max(spec["lengths"])
            while hi - lo > 0.05:
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if fits(spec, at(mid)) else (lo, mid)
            exc.params["lMax"] = math.floor(lo * 10) / 10


def _with_clearance(picks, spec, cl):
    """The splice held to a spacing to a neighbouring track (see clearance.py):
    checked at `radius`, or with `maximize` the largest radius that keeps it —
    where the case has a radius of its own to choose (not two arcs), for every
    pair of ends on its own, each radius with the cant the app proposes for it
    and the transitions as long as their mode asks at that radius and cant."""
    d_min = float(cl["dMin"])
    if not d_min > 0:
        raise ValueError("dMin")
    spacing = Spacing(cl["profile"])
    corners = [p[k] for p in picks for k in ("start", "end")]
    es, ns = [c[0] for c in corners], [c[1] for c in corners]
    neighbour = Neighbour(cl.get("ref") or [], (min(es), min(ns), max(es), max(ns)))
    speed = float(cl.get("speed") or 0) or spec["speed"]
    model = cl.get("cantModel") or {}

    def cant_of(sol, u_new):
        d = sol["depPick"]

        def of(el):
            sign = 1.0 if el["radius"] > 0 else -1.0
            role = el.get("role", "new")
            return sign * (picks[d]["cant"] if role == "dep" else picks[1 - d]["cant"] if role == "arr" else u_new)
        return of

    def described(sol, u_new, extra):
        worst = check(sol["elements"], neighbour, spacing, d_min, cant_of(sol, u_new))
        info = {"dMin": d_min, "near": worst is not None, **extra}
        if worst is not None:
            info.update(worst)
            info["kept"] = worst["margin"] >= -1e-6
        else:
            info["kept"] = True
        return info

    free = not (picks[0]["radius"] is not None and picks[1]["radius"] is not None)
    if cl.get("maximize") and free:
        # The arc inserted has to be an element of its own length: between an
        # arc and a straight the old arc can otherwise be run on round to the
        # straight, and the "largest radius" is a sliver of any radius at all.
        l_min = float(cl.get("lMin") or 0)

        def search(pk, ends, sp):
            r_max = clearance.R_MAX
            try:
                _solve(pk, ends, {**sp, "radius": r_max})
            except SpliceError as exc:
                # Too large to fit on the elements at all: the search starts where it fits.
                if exc.params.get("rMax"):
                    r_max = float(exc.params["rMax"])

            def build(r):
                # The cant follows the radius as the app proposes it, and the
                # transitions in their mode follow both (AP S.6): each radius
                # tried is solved as it would be written.
                u = auto_cant(speed, r, model)
                try:
                    sol = _solve(pk, ends, {**sp, "radius": r, "cant": u})
                except SpliceError:
                    return None
                if sol["info"].get("arcLength", 0) < l_min:
                    return None
                sol["clearance"] = described(sol, u, {"cant": u})
                return sol

            r, sol = largest_radius(build, lambda sol: sol["clearance"]["kept"], r_max=r_max)
            if r is None:
                raise SpliceError("splice_error_clearance", dMin=d_min)
            sol["info"]["clearance"] = {**sol.pop("clearance"), "radius": r, "maximized": True}
            return sol
        return _solutions(picks, spec, build=search)

    def checked(pk, ends, sp):
        sol = _solve(pk, ends, sp)
        sol["info"]["clearance"] = described(sol, abs(float(cl.get("cant") or 0)), {})
        return sol
    return _solutions(picks, spec, build=checked)


def splice_payload(payload):
    """The answer to `POST /splice`.

    Body: {"dep": pick, "arr": pick, "radius": m, "speed": km/h, "cant": mm,
           "lDep": m, "lArr": m, "modeDep": mode, "modeArr": mode,
           "transition": "clothoid"|"bloss", "arcJoin": "straight"|"transition",
           "clearance": optional, see below}
    with a pick {"start": [e, n], "end": [e, n], "bearing": deg at the end,
    "radius": signed m or null, "cant": mm, "speed": km/h, "length": m,
    "before": m, "after": m} — `before` and `after` how much of its track
    lies before and after it. `dep` and `arr` are the two picks in the order
    they were clicked, `lDep` and `lArr` the transitions beside each (0: none)
    with their mode — 'fixed' (the default), 'regular' or 'minimum' (`_solve`);
    which one departs the service finds (`_solutions`). `speed` and `cant`
    are those of what the splice inserts (the cant on a new arc).

    Answers {"solutions": [solution, …]}, the best first, each {"elements",
    "info", "depPick": 0|1 (which pick departs), "ends": [the first pick's
    end that meets, the second's], "reverseDep", "reverseArr", "rebuilt": m,
    "lengths": [the transition beside each pick: {mode, length, regular,
    minimum, regularBy, minimumBy}], "findings": [{at, index, id, severity}],
    "worst": severity, "judged": bool} — every element with the speed and
    cant it was judged with (`_judge`)
    — or {"error": key, "params": {...}} for a splice that does not fit
    where any two ends meet, `params` saying what would (`_explain`: rMax,
    rMin, lMax). Where only the other way of joining two arcs fits, beside the
    solutions `requested`: {"error", "params"} for the way asked for. A body that is not one raises ValueError.

    `clearance` holds the splice to a spacing to another track (clearance.py):
    {"ref": [[e, n, cant], …] its axis in this plane, "dMin": m, "profile":
    [[y, z], …] the half clearance outline in mm, "cant": mm on the new arc,
    "maximize": bool, "speed": km/h and "cantModel": {coeff, defCoeff, defMin,
    max, step} for the cant at each radius tried, "lMin": m the shortest arc
    the search may insert (LP.EL.01 at that speed)}. Each solution's info then
    carries `clearance`: dMin, kept, near and — where the neighbour lies near —
    margin, distance, required, cantNew, cantRef, at, ref; with `maximize` also
    radius and cant. No radius that keeps it is the error
    `splice_error_clearance`.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload")
    picks = [_pick(payload.get("dep")), _pick(payload.get("arr"))]
    modes = [payload.get("modeDep") or "fixed", payload.get("modeArr") or "fixed"]
    if any(m not in LENGTH_MODES for m in modes):
        raise ValueError("mode")
    spec = {
        "radius": float(payload.get("radius") or 0),
        "lengths": [max(0.0, float(payload.get("lDep") or 0)), max(0.0, float(payload.get("lArr") or 0))],
        "modes": modes,
        "profile": payload.get("transition", "clothoid"),
        "arcJoin": payload.get("arcJoin") or "straight",
        "speed": max(0.0, float(payload.get("speed") or 0)),
        "cant": abs(float(payload.get("cant") or 0)),
    }
    if spec["profile"] not in ("clothoid", "bloss"):
        raise ValueError("transition")
    cl = payload.get("clearance")
    if cl is not None and not isinstance(cl, dict):
        raise ValueError("clearance")
    try:
        if cl:
            return _with_clearance(picks, spec, cl)
        return _solutions(picks, spec)
    except SpliceError as exc:
        return {"error": exc.code, "params": exc.params}
