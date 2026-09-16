"""Port of the app's geometry kernel (src/utils/clothoidUtils.js, optimizeUtils.js).

Conventions — identical to the JS side, verified against reference values:
  * plane coordinates (easting e, northing n) in the track's native CRS
  * compass bearings in degrees (0 = grid north, clockwise)
  * curvature kappa = -1/r; signed radius r > 0 = right-hand curve
  * transition profiles: 'clothoid' (linear curvature), 'bloss' (cubic)
"""

import math

DEG2RAD = math.pi / 180.0
RAD2DEG = 180.0 / math.pi

# Minimum ramp length factor: l >= k * v * du / 1000  [l m, v km/h, du mm]
RAMP_FACTOR = {"clothoid": 8.0, "bloss": 6.0}

U_MAX = 160.0   # max cant [mm]
U_STEP = 5.0    # cant grid step [mm]

# A curve group running through a turnout is held to the switch's limits rather
# than the line's — the same pair as src/utils/mapConstants.js (MAX_SWITCH_CANT,
# MAX_SWITCH_CANT_DEF). The 120 mm exception is deliberately not read here: it is
# a decision a designer writes down for one element, not headroom an automatic
# run may help itself to.
U_MAX_SWITCH = 100.0    # max cant on a switch route [mm]
UF_MAX_SWITCH = 110.0   # max cant deficiency on a switch route [mm]


def permissible_speed(radius, u, uf):
    """Permissible speed [km/h] for radius [m], cant u and cant deficiency uf [mm]."""
    return math.sqrt(abs(radius) * (u + uf) / 11.8)


def dir_of(bearing_deg):
    b = bearing_deg * DEG2RAD
    return (math.sin(b), math.cos(b))


def _kappa(r):
    return -1.0 / r if r not in (None, 0) else 0.0


def heading_at(profile, k1, k2, length, s):
    """Heading change (math angle) at arc position s of a transition."""
    dk = k2 - k1
    if profile == "bloss":
        return k1 * s + dk * (s ** 3 / (length * length) - s ** 4 / (2 * length ** 3))
    return k1 * s + dk * s * s / (2 * length)


def transition_shift(length, radius, profile="clothoid"):
    """Shift parameters (p, t, phi) of a straight-to-arc transition.

    Simpson integration like clothoidUtils.transitionShift; n = 200 is exact to
    well below 1e-9 m for railway L/R and keeps the optimizer fast.
    """
    if not length > 0:
        return 0.0, 0.0, 0.0
    k2 = 1.0 / radius
    n = 200
    h = length / n
    x = 0.0
    y = 0.0
    for i in range(n):
        s0 = i * h
        pa = heading_at(profile, 0.0, k2, length, s0)
        pm = heading_at(profile, 0.0, k2, length, s0 + h / 2)
        pb = heading_at(profile, 0.0, k2, length, s0 + h)
        x += h / 6 * (math.cos(pa) + 4 * math.cos(pm) + math.cos(pb))
        y += h / 6 * (math.sin(pa) + 4 * math.sin(pm) + math.sin(pb))
    phi = length / (2 * radius)
    return y + radius * math.cos(phi) - radius, x - radius * math.sin(phi), phi


def sample_transition(e, n, bearing_deg, length, r1, r2, profile="clothoid", steps=16):
    """Points along a transition (composite Simpson per step, on-curve vertices)."""
    k1 = _kappa(r1)
    k2 = _kappa(r2)
    phi0 = (90.0 - bearing_deg) * DEG2RAD
    pts = [(e, n)]
    x, y = e, n
    h = length / steps
    for i in range(steps):
        a = i * h
        pa = phi0 + heading_at(profile, k1, k2, length, a)
        pm = phi0 + heading_at(profile, k1, k2, length, a + h / 2)
        pb = phi0 + heading_at(profile, k1, k2, length, a + h)
        x += h / 6 * (math.cos(pa) + 4 * math.cos(pm) + math.cos(pb))
        y += h / 6 * (math.sin(pa) + 4 * math.sin(pm) + math.sin(pb))
        pts.append((x, y))
    return pts


def transition_end(e, n, bearing_deg, length, r1, r2, profile="clothoid", steps=64):
    """End point and end bearing of a transition."""
    pts = sample_transition(e, n, bearing_deg, length, r1, r2, profile, steps)
    k1 = _kappa(r1)
    k2 = _kappa(r2)
    dphi_end = (k1 + k2) * length / 2
    end_bearing = (bearing_deg - dphi_end * RAD2DEG) % 360.0
    return pts[-1][0], pts[-1][1], end_bearing


def arc_center(s_e, s_n, e_e, e_n, signed_r):
    """Centre of the arc through two points with a signed radius (or None)."""
    dx = e_e - s_e
    dy = e_n - s_n
    chord = math.hypot(dx, dy)
    abs_r = abs(signed_r)
    if chord < 1e-6 or abs_r < chord / 2:
        return None
    rpx = dy / chord
    rpy = -dx / chord
    h = math.sqrt(abs_r * abs_r - (chord / 2) ** 2)
    sgn = -1.0 if signed_r >= 0 else 1.0
    return (s_e + e_e) / 2 - sgn * h * rpx, (s_n + e_n) / 2 - sgn * h * rpy


def arc_sweep(s_e, s_n, e_e, e_n, cx, cy, signed_r):
    """Signed sweep angle between the two endpoint angles (app convention)."""
    two_pi = 2 * math.pi
    a1 = math.atan2(s_n - cy, s_e - cx)
    a2 = math.atan2(e_n - cy, e_e - cx)
    if signed_r >= 0:
        return -(((a1 % two_pi) - (a2 % two_pi) + two_pi) % two_pi)
    return ((a2 % two_pi) - (a1 % two_pi) + two_pi) % two_pi


def sample_arc(s_e, s_n, e_e, e_n, signed_r, max_step_angle=0.02):
    ac = arc_center(s_e, s_n, e_e, e_n, signed_r)
    if ac is None:
        return [(s_e, s_n), (e_e, e_n)]
    cx, cy = ac
    sweep = arc_sweep(s_e, s_n, e_e, e_n, cx, cy, signed_r)
    abs_r = abs(signed_r)
    n_seg = max(2, min(200, math.ceil(abs(sweep) / max_step_angle)))
    a1 = math.atan2(s_n - cy, s_e - cx)
    return [
        (cx + abs_r * math.cos(a1 + i / n_seg * sweep), cy + abs_r * math.sin(a1 + i / n_seg * sweep))
        for i in range(n_seg + 1)
    ]


def arc_bearing_at(angle, curve_side):
    """Compass tangent bearing at circle angle `angle` for the given curve side."""
    if curve_side == "right":
        return (math.atan2(math.sin(angle), -math.cos(angle)) * RAD2DEG + 360.0) % 360.0
    return (math.atan2(-math.sin(angle), math.cos(angle)) * RAD2DEG + 360.0) % 360.0


def fit_curve_group(p1, d1, p2, d2, radius, l1, l2, type1="clothoid", type2="clothoid"):
    """Fit transition-arc-transition between two directed tangent lines.

    p1/d1: point on + direction of the entry line (outer end of entry straight),
    p2/d2: point on + direction of the exit line (outer end of exit straight).
    Port of optimizeUtils.fitCurveGroup; returns None when no valid fit exists.
    """
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    dot = d1[0] * d2[0] + d1[1] * d2[1]
    turn = math.atan2(cross, dot)
    if abs(turn) < 1e-9:
        return None
    curve_side = "left" if turn > 0 else "right"
    curve_sign = 1.0 if curve_side == "right" else -1.0
    signed_r = -radius if curve_side == "left" else radius

    p1_shift, t1, phi1 = transition_shift(l1, radius, type1)
    p2_shift, t2, phi2 = transition_shift(l2, radius, type2)

    rhs1 = curve_sign * (radius + p1_shift) + p1[0] * d1[1] - p1[1] * d1[0]
    rhs2 = curve_sign * (radius + p2_shift) + p2[0] * d2[1] - p2[1] * d2[0]
    det = cross
    ce = (-rhs1 * d2[0] + rhs2 * d1[0]) / det
    cn = (d1[1] * rhs2 - d2[1] * rhs1) / det

    proj1 = (ce - p1[0]) * d1[0] + (cn - p1[1]) * d1[1]
    virt1 = (p1[0] + proj1 * d1[0], p1[1] + proj1 * d1[1])
    proj2 = (ce - p2[0]) * d2[0] + (cn - p2[1]) * d2[1]
    virt2 = (p2[0] + proj2 * d2[0], p2[1] + proj2 * d2[1])
    cl_start = (virt1[0] - t1 * d1[0], virt1[1] - t1 * d1[1])
    cl_end = (virt2[0] + t2 * d2[0], virt2[1] + t2 * d2[1])

    th1 = math.atan2(virt1[1] - cn, virt1[0] - ce)
    th2 = math.atan2(virt2[1] - cn, virt2[0] - ce)
    arc_start_ang = th1 - phi1 * curve_sign
    arc_end_ang = th2 + phi2 * curve_sign
    sweep = arc_end_ang - arc_start_ang
    if curve_side == "left" and sweep < 0:
        sweep += 2 * math.pi
    if curve_side == "right" and sweep > 0:
        sweep -= 2 * math.pi
    if abs(sweep) < 1e-6 or abs(sweep) > math.pi + 1e-6:
        return None

    arc_start = (ce + radius * math.cos(arc_start_ang), cn + radius * math.sin(arc_start_ang))
    arc_end = (ce + radius * math.cos(arc_end_ang), cn + radius * math.sin(arc_end_ang))
    entry_len = (cl_start[0] - p1[0]) * d1[0] + (cl_start[1] - p1[1]) * d1[1]
    exit_len = (p2[0] - cl_end[0]) * d2[0] + (p2[1] - cl_end[1]) * d2[1]

    return {
        "R": radius,
        "signed_r": signed_r,
        "curve_side": curve_side,
        "centre": (ce, cn),
        "arc_start_ang": arc_start_ang,
        "sweep": sweep,
        "cl_start": cl_start,
        "cl_end": cl_end,
        "arc_start": arc_start,
        "arc_end": arc_end,
        "arc_len": abs(sweep) * radius,
        "entry_len": entry_len,
        "exit_len": exit_len,
        "arc_start_bearing": arc_bearing_at(arc_start_ang, curve_side),
        "arc_end_bearing": arc_bearing_at(arc_start_ang + sweep, curve_side),
    }


def _arc_forward(e, n, bearing, signed_r, sweep_mag):
    """March along an arc: end point and end bearing after |sweep| radians."""
    side = 1.0 if signed_r >= 0 else -1.0        # +1 = right-hand curve
    d = dir_of(bearing)
    abs_r = abs(signed_r)
    cx = e + abs_r * (d[1] if side > 0 else -d[1])
    cy = n + abs_r * (-d[0] if side > 0 else d[0])
    ang = -side * sweep_mag                       # right = clockwise in the plane
    ca, sa = math.cos(ang), math.sin(ang)
    rx, ry = e - cx, n - cy
    end = (cx + rx * ca - ry * sa, cy + rx * sa + ry * ca)
    return end, (bearing + side * sweep_mag * RAD2DEG) % 360.0


def fit_compound_group(p1, d1, b1, p2, d2, b2, radii, sweeps_free, trans_l, types):
    """Fit a (compound) curve of n same-side arcs between two directed tangents.

    radii:       [R_1..R_n] positive; all arcs turn to the same side.
    sweeps_free: [theta_1..theta_{n-1}] arc sweeps in radians (magnitudes); the
                 last sweep follows from the corner's total turn.
    trans_l:     n+1 transition lengths (entry, between arcs, exit; 0 = none).
    types:       n+1 transition profiles.

    Forward construction from the entry tangent; the start position along the
    entry line is then solved linearly so the end lands on the exit line
    (end heading matches by construction). For n = 1 this is equivalent to
    fit_curve_group. Returns None when no valid fit exists.
    """
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    dot = d1[0] * d2[0] + d1[1] * d2[1]
    turn = math.atan2(cross, dot)
    if abs(turn) < 1e-9:
        return None
    side = -1.0 if turn > 0 else 1.0              # +1 = right-hand curves
    n = len(radii)
    signed = [side * r for r in radii]

    phi = []
    for i, length in enumerate(trans_l):
        if length <= 0:
            phi.append(0.0)
            continue
        k1 = 0.0 if i == 0 else 1.0 / radii[i - 1]
        k2 = 0.0 if i == n else 1.0 / radii[i]
        phi.append(length * (k1 + k2) / 2)

    theta_last = abs(turn) - sum(sweeps_free) - sum(phi)
    thetas = list(sweeps_free) + [theta_last]
    if any(t <= 1e-6 for t in thetas) or sum(thetas) + sum(phi) > math.pi:
        return None

    # March in local coordinates (anchor at the entry tangent point).
    segments = []
    pos, brg = (0.0, 0.0), b1

    def add_transition(i):
        nonlocal pos, brg
        length = trans_l[i]
        if length <= 0:
            return
        r1 = None if i == 0 else signed[i - 1]
        r2 = None if i == n else signed[i]
        segments.append({"kind": "transition", "start": pos, "bearing": brg,
                         "L": length, "r1": r1, "r2": r2, "type": types[i]})
        ee, en, eb = transition_end(pos[0], pos[1], brg, length, r1, r2, types[i])
        pos, brg = (ee, en), eb

    for i in range(n):
        add_transition(i)
        start, sb = pos, brg
        pos, brg = _arc_forward(pos[0], pos[1], brg, signed[i], thetas[i])
        segments.append({"kind": "arc", "start": start, "end": pos, "signed_r": signed[i],
                         "sweep": thetas[i], "bearing": sb, "end_bearing": brg})
    add_transition(n)

    # Solve the start position s along the entry line: end must lie on the exit line.
    n2 = (-d2[1], d2[0])
    denom = d1[0] * n2[0] + d1[1] * n2[1]
    if abs(denom) < 1e-12:
        return None
    s = ((p2[0] - p1[0] - pos[0]) * n2[0] + (p2[1] - p1[1] - pos[1]) * n2[1]) / denom
    ax, ay = p1[0] + s * d1[0], p1[1] + s * d1[1]

    def shift(pt):
        return (pt[0] + ax, pt[1] + ay)

    for seg in segments:
        seg["start"] = shift(seg["start"])
        if "end" in seg:
            seg["end"] = shift(seg["end"])
    end_pt = shift(pos)
    return {
        "segments": segments,
        "cl_start": (ax, ay),
        "cl_end": end_pt,
        "entry_len": s,
        "exit_len": (p2[0] - end_pt[0]) * d2[0] + (p2[1] - end_pt[1]) * d2[1],
        "thetas": thetas,
        "signed": signed,
        "curve_side": "right" if side > 0 else "left",
    }


# ── Distances (numpy-accelerated when available) ─────────────────────────────

try:
    import numpy as _np
except ImportError:                                   # pragma: no cover
    _np = None


def max_dist_to_polyline(points, poly):
    """Max over `points` of the distance to the polyline `poly`."""
    if len(points) == 0 or len(poly) < 2:
        return 0.0
    if _np is not None:
        pts = _np.asarray(points)                     # (n, 2)
        seg = _np.asarray(poly)                       # (m, 2)
        a, b = seg[:-1], seg[1:]                      # (m-1, 2)
        ab = b - a
        den = (ab ** 2).sum(axis=1)
        den[den == 0] = 1.0
        ap = pts[:, None, :] - a[None, :, :]          # (n, m-1, 2)
        t = _np.clip((ap * ab[None, :, :]).sum(axis=2) / den[None, :], 0.0, 1.0)
        q = a[None, :, :] + t[:, :, None] * ab[None, :, :]
        d = _np.sqrt(((pts[:, None, :] - q) ** 2).sum(axis=2))
        return float(d.min(axis=1).max())
    best_max = 0.0
    for px, py in points:
        best = math.inf
        for (ax, ay), (bx, by) in zip(poly[:-1], poly[1:]):
            dx, dy = bx - ax, by - ay
            den = dx * dx + dy * dy
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den)) if den > 0 else 0.0
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            best = min(best, d)
        best_max = max(best_max, best)
    return best_max
