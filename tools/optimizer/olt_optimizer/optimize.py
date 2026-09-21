"""Track optimization (simple curves and compound curves / Korbbögen).

Model:
  * variables: lateral shifts s_i of the interior straights (parallel, bearing
    fixed); per curve group with n arcs: radii R_1..R_n, cants u_1..u_n and the
    free sweep splits theta_1..theta_{n-1} (the last sweep closes the corner),
  * objective: maximize the bottleneck speed min v over all optimizable arcs,
    v = sqrt(R (u + uf) / 11.8); the whole group runs at its min v,
  * constraints: max lateral offset to the existing alignment <= corridor,
    element lengths >= 0.2 v, ramp lengths l >= k v du / 1000 (k = 8 clothoid,
    6 Bloss; du = cant step across the ramp), u <= 160 mm, track ends fixed.

`baseline` reproduces the in-app per-curve search for simple groups (s = 0,
u grid + R bisection); compound groups enter at their existing geometry.
`joint_optimize` runs scipy differential_evolution over the full vector,
warm-started and guarded so it never falls below the baseline. A cant u_i may
only rise when the ramps on both sides of arc i exist.
"""

import math

from .geometry import (
    fit_compound_group, permissible_speed, sample_transition, sample_arc,
    max_dist_to_polyline, RAMP_FACTOR, U_MAX, U_MAX_SWITCH, UF_MAX_SWITCH, U_STEP,
)

PENALTY = 1000.0


def u_max_for(g):
    """Cant ceiling of a group: the switch's where it runs through one."""
    return U_MAX_SWITCH if g.get("on_switch") else U_MAX


def uf_for(g, params):
    """Deficiency the group is evaluated at — never over what a switch admits."""
    return min(params["uf"], UF_MAX_SWITCH) if g.get("on_switch") else params["uf"]


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def _u_variable(g, i):
    """Cant of arc i may only rise when both adjacent ramps exist."""
    return g["has_t"][i] and g["has_t"][i + 1]


def ramp_lengths(g, v, us):
    """Transition lengths per slot for group speed v and per-arc cants."""
    min_len = 0.2 * v
    n = len(g["arcs"])
    du = [us[0]] + [abs(us[i + 1] - us[i]) for i in range(n - 1)] + [us[-1]]
    lengths = []
    for i in range(n + 1):
        if not g["has_t"][i]:
            lengths.append(0.0)
            continue
        lengths.append(max(min_len, RAMP_FACTOR[g["types"][i]] * v * du[i] / 1000.0))
    return lengths, min_len


def _sample_fit(fit):
    pts = []
    for seg in fit["segments"]:
        if seg["kind"] == "transition":
            part = sample_transition(seg["start"][0], seg["start"][1], seg["bearing"],
                                     seg["L"], seg["r1"], seg["r2"], seg["type"])
        else:
            part = sample_arc(seg["start"][0], seg["start"][1],
                              seg["end"][0], seg["end"][1], seg["signed_r"])
        pts.extend(part[1:] if pts else part)
    return pts


def fit_offset(g, fit, p1, p2, limit=None):
    """Max lateral deviation of the fitted curve zone vs. the original alignment.

    `limit` is the corridor the answer is about to be compared against. The two
    sweeps are measured in turn and the second is skipped once the first has
    already left the corridor — which is what most of the candidates the search
    puts through here do.
    """
    new_pts = _sample_fit(fit)
    offset = max_dist_to_polyline(new_pts, g["ref_poly"])
    if limit is not None and offset > limit:
        return offset
    new_poly = [p1] + new_pts + [p2]
    return max(offset, max_dist_to_polyline(g["ref_curve_pts"], new_poly))


def evaluate_group(g, radii, us, thetas_free, params, p1=None, p2=None, trans_l=None):
    """Feasibility evaluation of one group; returns a solution dict or None.

    trans_l: the ramp lengths to fit with. Passing the existing ones reproduces
    the group as it lies, and then the ramp and minimum-length rules are not
    applied to it: an existing alignment is a fact to start from, not a
    proposal to judge. Everything the run proposes leaves this at None and is
    held to both rules.
    """
    p1 = p1 or g["p1"]
    p2 = p2 or g["p2"]
    v_arcs = [permissible_speed(r, u, uf_for(g, params)) for r, u in zip(radii, us)]
    v = min(v_arcs)
    proposed = trans_l is None
    if proposed:
        trans_l, min_len = ramp_lengths(g, v, us)
    fit = fit_compound_group(p1, g["d1"], g["b1"], p2, g["d2"], g["b2"],
                             radii, thetas_free, trans_l, g["types"])
    if fit is None:
        return None
    if proposed:
        if fit["entry_len"] < min_len or fit["exit_len"] < min_len:
            return None
        for seg in fit["segments"]:
            if seg["kind"] == "arc" and abs(seg["sweep"] * seg["signed_r"]) < min_len:
                return None
    offset = fit_offset(g, fit, p1, p2, params["corridor"])
    if offset > params["corridor"]:
        return None
    return {"radii": list(radii), "us": list(us), "thetas_free": list(thetas_free),
            "v": v, "trans_l": trans_l, "fit": fit, "offset": offset}


def _max_radius_for(g, u, params):
    """Largest feasible R for a simple group at fixed cant (bisection)."""
    r_alt = g["arcs"][0]["r_alt"]
    feasible = lambda radius: evaluate_group(g, [radius], [u], [], params)   # noqa: E731
    lo = hi = None
    if feasible(r_alt):
        lo = r_alt
        radius = r_alt
        for _ in range(60):
            radius *= 1.5
            if radius > 1e6:
                break
            if feasible(radius):
                lo = radius
            else:
                hi = radius
                break
        if hi is None:
            return feasible(lo)
    else:
        radius = r_alt
        for _ in range(40):
            radius *= 0.85
            if feasible(radius):
                lo = radius
                break
        if lo is None:
            return None
        hi = lo / 0.85
    while hi - lo > 0.01:
        mid = (lo + hi) / 2
        if feasible(mid):
            lo = mid
        else:
            hi = mid
    return feasible(lo)


def _bestand_solution(g, params):
    """Re-fit a group at its existing parameters (compound baseline / lock check).

    With the existing ramps, so this lands back on the existing alignment — the
    ramp rule would hand out different lengths and move the curve off it, which
    on a compound curve is enough to fail the corridor and lock a group that is
    simply what is already built.
    """
    radii = [a["r_alt"] for a in g["arcs"]]
    us = [a["u_alt"] for a in g["arcs"]]
    thetas = [a["sweep_alt"] for a in g["arcs"][:-1]]
    return evaluate_group(g, radii, us, thetas, params, trans_l=g["t_len"])


def window_for(groups, target_gi):
    """Group indices of the optimization window around a target group: the
    target plus the neighbours that share a straight with it."""
    window = {target_gi}
    if target_gi > 0 and groups[target_gi - 1]["exit_idx"] == groups[target_gi]["entry_idx"]:
        window.add(target_gi - 1)
    if target_gi + 1 < len(groups) and groups[target_gi + 1]["entry_idx"] == groups[target_gi]["exit_idx"]:
        window.add(target_gi + 1)
    return window


def baseline(groups, params, window=None, target_gi=None):
    """Per-curve optimization with straights on their existing lines (s = 0).

    Simple groups: u grid + R bisection. Compound groups enter at their
    existing geometry (the joint stage optimizes them); groups without any
    feasible fit are locked (solution None → kept unchanged).

    window/target_gi (element mode): groups outside the window stay locked;
    window neighbours of the target enter at their existing geometry.
    """
    solutions = []
    for j, g in enumerate(groups):
        if window is not None and j not in window:
            solutions.append(None)
            continue
        if window is not None and j != target_gi:
            solutions.append(_bestand_solution(g, params))
            continue
        if len(g["arcs"]) > 1:
            solutions.append(_bestand_solution(g, params))
            continue
        u_alt = g["arcs"][0]["u_alt"]
        # The existing cant is always a candidate, even where it already stands
        # above what the group may be raised to: the run improves an alignment,
        # it does not quietly re-cant one that is already over its limit.
        u_values = [u_alt]
        if _u_variable(g, 0):
            u = math.ceil(u_alt / U_STEP) * U_STEP
            while u <= u_max_for(g):
                if u > u_alt:
                    u_values.append(u)
                u += U_STEP
        best = None
        for u in u_values:
            cand = _max_radius_for(g, u, params)
            if cand and (best is None or cand["v"] > best["v"]):
                best = cand
        solutions.append(best)
    return solutions


# ── Joint optimization (shiftable interior straights) ────────────────────────

def _interior_straights(groups, n_elements):
    shared = set()
    for g in groups:
        if g["entry_idx"] != 0:
            shared.add(g["entry_idx"])
        if g["exit_idx"] != n_elements - 1:
            shared.add(g["exit_idx"])
    return sorted(shared)


def _shifted_anchor(point, bearing_dir, s):
    normal = (-bearing_dir[1], bearing_dir[0])
    return (point[0] + s * normal[0], point[1] + s * normal[1])


def _layout(groups, straight_ids):
    """Variable layout: shifts, then per group [R_1..R_n, u_1..u_n, th_1..th_{n-1}]."""
    slices = []
    pos = len(straight_ids)
    for g in groups:
        n = len(g["arcs"])
        slices.append((pos, n))
        pos += 3 * n - 1
    return slices, pos


def _decode(x, groups, straight_ids, params):
    shifts = {idx: _clamp(x[i], -params["corridor"], params["corridor"])
              for i, idx in enumerate(straight_ids)}
    slices, _ = _layout(groups, straight_ids)
    per_group = []
    for g, (pos, n) in zip(groups, slices):
        radii = [max(25.0, x[pos + i]) for i in range(n)]
        us = []
        for i in range(n):
            u_alt = g["arcs"][i]["u_alt"]
            u = x[pos + n + i] if _u_variable(g, i) else u_alt
            # lo before hi: a group already over its ceiling keeps what it has
            # rather than being pulled down to it.
            u = _clamp(u, u_alt, max(u_alt, u_max_for(g)))
            # cants live on the 5 mm grid — quantize inside the objective so
            # every evaluated candidate is directly usable
            us.append(max(u_alt, math.floor(u / U_STEP) * U_STEP))
        thetas = [max(1e-4, x[pos + 2 * n + i]) for i in range(n - 1)]
        per_group.append((radii, us, thetas))
    return shifts, per_group


def _evaluate_vector(x, groups, straight_ids, params, locked):
    shifts, per_group = _decode(x, groups, straight_ids, params)
    solutions = []
    penalty = 0.0
    for j, g in enumerate(groups):
        if locked[j]:
            solutions.append(None)
            continue
        radii, us, thetas = per_group[j]
        p1 = _shifted_anchor(g["p1"], g["d1"], shifts.get(g["entry_idx"], 0.0))
        p2 = _shifted_anchor(g["p2"], g["d2"], shifts.get(g["exit_idx"], 0.0))
        sol = evaluate_group(g, radii, us, thetas, params, p1, p2)
        if sol is None:
            penalty += 1.0
        solutions.append(sol)
    for j in range(len(groups) - 1):
        a, b = solutions[j], solutions[j + 1]
        ga, gb = groups[j], groups[j + 1]
        if a is None or b is None or ga["exit_idx"] != gb["entry_idx"]:
            continue
        d = ga["d2"]
        remaining = ((b["fit"]["cl_start"][0] - a["fit"]["cl_end"][0]) * d[0]
                     + (b["fit"]["cl_start"][1] - a["fit"]["cl_end"][1]) * d[1])
        need = 0.2 * max(a["v"], b["v"])
        if remaining < need:
            penalty += (need - remaining) / need
    return solutions, penalty


def _objective(x, groups, straight_ids, params, locked, target_gi=None, v_floors=None):
    solutions, penalty = _evaluate_vector(x, groups, straight_ids, params, locked)
    missing = sum(1 for j, s in enumerate(solutions) if not locked[j] and s is None)
    if target_gi is not None:
        # Element mode: maximize the target's v; neighbours may be re-shaped
        # but must not fall below their existing speed (soft floor).
        t = solutions[target_gi]
        if t is None or missing:
            return PENALTY * (1.0 + penalty + missing)
        short = sum(max(0.0, v_floors[j] - s["v"])
                    for j, s in enumerate(solutions) if s is not None and j != target_gi)
        return -t["v"] + PENALTY * (penalty + short)
    vs = [s["v"] for j, s in enumerate(solutions) if not locked[j] and s is not None]
    if missing or not vs:
        return PENALTY * (1.0 + penalty + missing)
    return -min(vs) + PENALTY * penalty


def joint_optimize(groups, n_elements, params, maxiter=150, seed=1, target_gi=None):
    from scipy.optimize import differential_evolution, minimize

    window = window_for(groups, target_gi) if target_gi is not None else None
    base = baseline(groups, params, window=window, target_gi=target_gi)
    locked = [sol is None for sol in base]
    # Straights next to a locked (unchanged) group must not shift — the locked
    # group's original elements sit on the unshifted line.
    locked_adjacent = set()
    for g, is_locked in zip(groups, locked):
        if is_locked:
            locked_adjacent |= {g["entry_idx"], g["exit_idx"]}
    straight_ids = [i for i in _interior_straights(groups, n_elements) if i not in locked_adjacent]

    x0 = [0.0] * len(straight_ids)
    bounds = [(-params["corridor"], params["corridor"])] * len(straight_ids)
    for g, sol in zip(groups, base):
        n = len(g["arcs"])
        radii = sol["radii"] if sol else [a["r_alt"] for a in g["arcs"]]
        us = sol["us"] if sol else [a["u_alt"] for a in g["arcs"]]
        thetas = sol["thetas_free"] if sol else [a["sweep_alt"] for a in g["arcs"][:-1]]
        x0 += radii + us + thetas
        bounds += [(max(25.0, 0.25 * a["r_alt"]), 10.0 * a["r_alt"]) for a in g["arcs"]]
        bounds += [(a["u_alt"], max(a["u_alt"], u_max_for(g))) for a in g["arcs"]]
        bounds += [(max(1e-3, 0.2 * a["sweep_alt"]), min(math.pi, 2.5 * max(a["sweep_alt"], 1e-3)))
                   for a in g["arcs"][:-1]]

    v_floors = [min(permissible_speed(a["r_alt"], a["u_alt"], uf_for(g, params)) for a in g["arcs"])
                for g in groups]
    args = (groups, straight_ids, params, locked, target_gi, v_floors)
    if all(locked):
        return base, {}, base

    result = differential_evolution(_objective, bounds, args=args, maxiter=maxiter,
                                    seed=seed, polish=False, tol=1e-6, x0=x0)
    polished = minimize(_objective, result.x, args=args, method="Nelder-Mead",
                        options={"maxiter": 3000, "xatol": 1e-4, "fatol": 1e-6})
    best_x, best_f = None, math.inf
    for x in (x0, result.x, polished.x):
        f = _objective(x, *args)
        if f < best_f:
            best_x, best_f = x, f

    solutions, _ = _evaluate_vector(best_x, groups, straight_ids, params, locked)
    if any(s is None for j, s in enumerate(solutions) if not locked[j]):
        return base, {}, base
    shifts, _ = _decode(best_x, groups, straight_ids, params)
    return solutions, shifts, base
