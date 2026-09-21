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
`joint_optimize` sweeps windows along the track — a group plus whoever
shares a straight with it — running scipy differential_evolution over each,
warm-started and guarded so it never falls below the baseline. A cant u_i may
only rise when the ramps on both sides of arc i exist.
"""

import math

from .geometry import (
    fit_compound_group, permissible_speed, sample_transition, sample_arc,
    max_dist_to_polyline, radius_for_speed, snap_down, snap_up, RAMP_FACTOR,
    U_MAX, U_MAX_SWITCH, UF_MAX_SWITCH, U_STEP, R_STEP, R_MIN, L_STEP,
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


def capped(v, params):
    """Speed as the objective counts it.

    Above the target speed there is nothing left to win, so everything above it
    counts the same. The run then stops trading the existing alignment away for
    speed nobody asked for, and stops altogether once its slowest curve has
    arrived — which is most of what makes a target worth giving.
    """
    v_max = params.get("v_max")
    return min(v, v_max) if v_max else v


def _radius_cap(g, u, params, r_alt):
    """The radius past which a run has nothing to gain at this cant: the one
    that reaches the target speed. Never below what is already built — a run
    improves an alignment, it does not flatten one that is fast enough."""
    v_max = params.get("v_max")
    if not v_max:
        return math.inf
    return max(r_alt, radius_for_speed(v_max, u, uf_for(g, params)))


def _u_variable(g, i):
    """Cant of arc i may only rise when both adjacent ramps exist."""
    return g["has_t"][i] and g["has_t"][i + 1]


def ramp_lengths(g, v, us):
    """Transition lengths per slot for group speed v and per-arc cants.

    Handed out on the length grid, rounded up: a ramp that is a little longer
    than the rules ask for still satisfies them, one a little shorter does not.
    """
    min_len = 0.2 * v
    n = len(g["arcs"])
    du = [us[0]] + [abs(us[i + 1] - us[i]) for i in range(n - 1)] + [us[-1]]
    lengths = []
    for i in range(n + 1):
        if not g["has_t"][i]:
            lengths.append(0.0)
            continue
        need = max(min_len, RAMP_FACTOR[g["types"][i]] * v * du[i] / 1000.0)
        lengths.append(snap_up(need, L_STEP))
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
    """Largest useful R for a simple group at fixed cant (bisection).

    Useful, not largest: past the radius that reaches the target speed the
    curve only moves further off the existing alignment for nothing.
    """
    r_alt = g["arcs"][0]["r_alt"]
    cap = _radius_cap(g, u, params, r_alt)
    # Every probe is snapped, so the search runs on the radii a run may hand
    # out and never converges on something between two metres. It is the
    # cheaper search too: the bracket closes at one metre instead of one
    # centimetre, and v goes with the square root of R — those last seven
    # rounds of the full feasibility check were worth 0.001 km/h.
    feasible = lambda radius: evaluate_group(                                # noqa: E731
        g, [max(R_MIN, snap_down(radius, R_STEP))], [u], [], params)
    lo = hi = None
    if feasible(r_alt):
        lo = r_alt
        radius = r_alt
        for _ in range(60):
            radius *= 1.5
            if radius >= cap:
                at_cap = feasible(cap)
                if at_cap:
                    return at_cap           # exactly the target speed, no further
                hi = cap
                break
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
    while hi - lo > R_STEP:
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
            # Judged by the capped speed, so the first cant that reaches the
            # target keeps the group: the ones above it buy nothing and only
            # ask for more re-canting.
            if cand and (best is None or capped(cand["v"], params) > capped(best["v"], params)):
                best = cand
        solutions.append(best)
    return solutions


# ── Joint optimization (shiftable interior straights) ────────────────────────
#
# One window at a time. The groups of a track couple only through the straights
# they share, so a window — a group plus whoever shares a straight with it — is
# a whole problem on its own; everything outside it is held where it stands.
# That keeps the search vector at the size of a window however long the track
# is, instead of growing with it and taking the population and the generations
# needed along with it.

# What one window's search may spend. Its vector is short — one group or three,
# plus the straights between them — and it starts from what the sweep already
# holds, so this refines a solution rather than looking for one from nothing.
# SciPy's default population of fifteen per dimension is sized for the latter,
# and on a sweep it is paid again at every window.
WINDOW_POPSIZE = 8
# The element mode runs one window and nothing after it, so it keeps SciPy's
# own population. It needs it: with the vector down to one window's worth of
# variables, a population of eight per dimension found nothing on a three-group
# track where ten found 3 km/h.
SINGLE_POPSIZE = 15
# Generations for the whole sweep, split over the windows it may run: a short
# track runs few of them and can give each a long search, a long one has to make
# the same total stretch further. Below the floor a window is not worth starting
# — measured on a two-group track, forty generations found nothing at all and
# sixty found 4 km/h.
SWEEP_BUDGET = 240
WINDOW_MIN_MAXITER = 40

# How far the sweep may go. The bottleneck usually settles well inside this and
# the run stops on its own; the cap is for the track that keeps finding a little
# more, so that it still answers inside the deadline the service gives it — a
# track may bring two thousand elements, and that is hundreds of groups.
# Measured over varied tracks of eight to twenty groups at the widest corridor
# the panel offers, raising it from six to eight bought 0.4 km/h on one track
# out of four and cost every one of them another twenty seconds.
SWEEP_MAX_WINDOWS = 6
# Steps per variable the local polish after a window's search may take.
POLISH_STEPS = 200


def _interior_straights(groups):
    """The straights a run may move sideways: the ones two groups share.

    A straight only one group reaches holds whatever lies beyond it, and that
    does not move along: the track's own end point, a stretch the parser could
    not read, or simply the next straight. Only where a group is fitted on both
    sides does moving the line between them keep the chain closed.
    """
    entries = {g["entry_idx"] for g in groups}
    return sorted(g["exit_idx"] for g in groups if g["exit_idx"] in entries)


def _shifted_anchor(point, bearing_dir, s):
    normal = (-bearing_dir[1], bearing_dir[0])
    return (point[0] + s * normal[0], point[1] + s * normal[1])


def _layout(ctx):
    """Variable layout: shifts, then per live group [R_1..R_n, u_1..u_n, th_1..th_{n-1}]."""
    slices = []
    pos = len(ctx["straight_ids"])
    for j in ctx["live"]:
        n = len(ctx["groups"][j]["arcs"])
        slices.append((pos, n))
        pos += 3 * n - 1
    return slices, pos


def _decode(x, ctx):
    params = ctx["params"]
    # The straights this window does not own keep the offset an earlier window
    # gave them — the groups beside them are fitted to that line, not to the
    # original one.
    shifts = dict(ctx["held_shifts"])
    for i, idx in enumerate(ctx["straight_ids"]):
        shifts[idx] = _clamp(x[i], -params["corridor"], params["corridor"])
    slices, _ = _layout(ctx)
    per_group = []
    for j, (pos, n) in zip(ctx["live"], slices):
        g = ctx["groups"][j]
        # radii live on the metre grid, cants on the 5 mm one — quantized
        # inside the objective so every evaluated candidate is directly usable
        radii = [max(R_MIN, snap_down(x[pos + i], R_STEP)) for i in range(n)]
        us = []
        for i in range(n):
            u_alt = g["arcs"][i]["u_alt"]
            u = x[pos + n + i] if _u_variable(g, i) else u_alt
            # lo before hi: a group already over its ceiling keeps what it has
            # rather than being pulled down to it.
            u = _clamp(u, u_alt, max(u_alt, u_max_for(g)))
            us.append(max(u_alt, snap_down(u, U_STEP)))
        thetas = [max(1e-4, x[pos + 2 * n + i]) for i in range(n - 1)]
        per_group.append((radii, us, thetas))
    return shifts, per_group


def _evaluate_vector(x, ctx):
    """The whole chain: the live groups fitted from `x`, the rest as held."""
    groups = ctx["groups"]
    params = ctx["params"]
    shifts, per_group = _decode(x, ctx)
    solutions = list(ctx["held"])
    penalty = 0.0
    for (radii, us, thetas), j in zip(per_group, ctx["live"]):
        g = groups[j]
        p1 = _shifted_anchor(g["p1"], g["d1"], shifts.get(g["entry_idx"], 0.0))
        p2 = _shifted_anchor(g["p2"], g["d2"], shifts.get(g["exit_idx"], 0.0))
        sol = evaluate_group(g, radii, us, thetas, params, p1, p2)
        if sol is None:
            penalty += 1.0
        solutions[j] = sol
    # Only the joints a live group sits on can have moved; the rest are as the
    # window that placed them left them.
    for j, k in ctx["pairs"]:
        a, b = solutions[j], solutions[k]
        ga, gb = groups[j], groups[k]
        if a is None or b is None or ga["exit_idx"] != gb["entry_idx"]:
            continue
        d = ga["d2"]
        remaining = ((b["fit"]["cl_start"][0] - a["fit"]["cl_end"][0]) * d[0]
                     + (b["fit"]["cl_start"][1] - a["fit"]["cl_end"][1]) * d[1])
        need = 0.2 * max(a["v"], b["v"])
        if remaining < need:
            penalty += (need - remaining) / need
    return solutions, penalty


def _objective(x, ctx):
    solutions, penalty = _evaluate_vector(x, ctx)
    live, params = ctx["live"], ctx["params"]
    missing = sum(1 for j in live if solutions[j] is None)
    target_gi = ctx["target_gi"]
    if target_gi is not None:
        # Element mode: maximize the target's v; neighbours may be re-shaped
        # but must not fall below their existing speed (soft floor).
        t = solutions[target_gi]
        if t is None or missing:
            return PENALTY * (1.0 + penalty + missing)
        floors = ctx["v_floors"]
        short = sum(max(0.0, floors[j] - solutions[j]["v"])
                    for j in live if j != target_gi and solutions[j] is not None)
        return -capped(t["v"], params) + PENALTY * (penalty + short)
    vs = [capped(solutions[j]["v"], params) for j in live if solutions[j] is not None]
    if missing or not vs:
        return PENALTY * (1.0 + penalty + missing)
    return -min(vs) + PENALTY * penalty


def _window_context(groups, params, held, held_shifts, live,
                    target_gi=None, v_floors=None):
    """Everything one window's objective needs, plus its start vector and bounds."""
    # A straight a held group sits on must not move: that group's elements are
    # fitted to the line where it is.
    frozen = set()
    for j, g in enumerate(groups):
        if j not in live:
            frozen |= {g["entry_idx"], g["exit_idx"]}
    straight_ids = [i for i in _interior_straights(groups) if i not in frozen]
    ctx = {
        "groups": groups, "live": live, "held": held, "held_shifts": held_shifts,
        "straight_ids": straight_ids, "params": params,
        "target_gi": target_gi, "v_floors": v_floors,
        "pairs": sorted({p for j in live for p in ((j - 1, j), (j, j + 1))
                         if p[0] >= 0 and p[1] < len(groups)}),
    }

    x0 = [held_shifts.get(i, 0.0) for i in straight_ids]
    bounds = [(-params["corridor"], params["corridor"])] * len(straight_ids)
    for j in live:
        g, sol = groups[j], held[j]
        radii = sol["radii"] if sol else [a["r_alt"] for a in g["arcs"]]
        us = sol["us"] if sol else [a["u_alt"] for a in g["arcs"]]
        thetas = sol["thetas_free"] if sol else [a["sweep_alt"] for a in g["arcs"][:-1]]
        x0 += list(radii) + list(us) + list(thetas)
        bounds += [(max(R_MIN, 0.25 * a["r_alt"]), 10.0 * a["r_alt"]) for a in g["arcs"]]
        bounds += [(a["u_alt"], max(a["u_alt"], u_max_for(g))) for a in g["arcs"]]
        bounds += [(max(1e-3, 0.2 * a["sweep_alt"]), min(math.pi, 2.5 * max(a["sweep_alt"], 1e-3)))
                   for a in g["arcs"][:-1]]
    # The polish at the end of a window is unconstrained, so a held solution can
    # carry a radius from outside the box it was searched in. It stays — it was
    # judged on its geometry, not on the box — but the next window may not be
    # started there: SciPy refuses a start vector outside its bounds.
    return ctx, [_clamp(v, lo, hi) for v, (lo, hi) in zip(x0, bounds)], bounds


def _run_window(ctx, x0, bounds, maxiter, seed, popsize):
    """Differential evolution over one window; None when it finds nothing usable.

    The start vector reproduces what is held, so the answer is never worse than
    what the window was given.
    """
    from scipy.optimize import differential_evolution, minimize

    result = differential_evolution(_objective, bounds, args=(ctx,), maxiter=maxiter,
                                    seed=seed, polish=False, tol=1e-6, x0=x0,
                                    popsize=popsize)
    # Both caps, not just the iteration one: given `maxiter` alone SciPy leaves
    # the evaluation count at infinity, and a simplex that keeps shrinking then
    # spends longer polishing one window than the search that fed it took.
    polished = minimize(_objective, result.x, args=(ctx,), method="Nelder-Mead",
                        options={"maxiter": POLISH_STEPS * len(x0), "xatol": 1e-4,
                                 "fatol": 1e-6, "maxfev": POLISH_STEPS * len(x0)})
    best_x, best_f = None, math.inf
    for x in (x0, result.x, polished.x):
        f = _objective(x, ctx)
        if f < best_f:
            best_x, best_f = x, f

    solutions, _ = _evaluate_vector(best_x, ctx)
    if any(solutions[j] is None for j in ctx["live"]):
        return None
    shifts, _ = _decode(best_x, ctx)
    return solutions, shifts


def joint_optimize(groups, params, maxiter=150, seed=1, target_gi=None):
    window = window_for(groups, target_gi) if target_gi is not None else None
    base = baseline(groups, params, window=window, target_gi=target_gi)
    if all(sol is None for sol in base):
        return base, {}, base

    v_floors = [min(permissible_speed(a["r_alt"], a["u_alt"], uf_for(g, params)) for a in g["arcs"])
                for g in groups]

    if target_gi is not None:
        live = [j for j in sorted(window) if base[j] is not None]
        out = _run_window(*_window_context(groups, params, base, {}, live,
                                           target_gi=target_gi, v_floors=v_floors),
                          maxiter, seed, SINGLE_POPSIZE)
        return (out[0], out[1], base) if out else (base, {}, base)

    # Track mode. What is being maximized is the slowest group, so that is the
    # group to work on — and its own window is the only one that can raise it:
    # a group hangs on its two straights, and no other window owns both. Raise
    # it, then look for whoever is slowest now; stop when the slowest will not
    # move, because then nothing else will move the bottleneck either.
    solutions = list(base)
    shifts = {}
    reachable = [j for j, sol in enumerate(base) if sol is not None]
    rounds = min(len(reachable) + 2, SWEEP_MAX_WINDOWS)
    window_maxiter = max(WINDOW_MIN_MAXITER, min(maxiter, SWEEP_BUDGET // rounds))
    v_max = params.get("v_max")
    for _ in range(rounds):
        target = min(reachable, key=lambda j: capped(solutions[j]["v"], params))
        if v_max and capped(solutions[target]["v"], params) >= v_max:
            break                       # the slowest curve is already fast enough
        live = [j for j in sorted(window_for(groups, target)) if solutions[j] is not None]
        before = min(capped(solutions[j]["v"], params) for j in live)
        out = _run_window(*_window_context(groups, params, solutions, shifts, live),
                          window_maxiter, seed, WINDOW_POPSIZE)
        if out is None:
            break
        after = min(capped(out[0][j]["v"], params) for j in live)
        if after <= before + 1e-9:
            break
        solutions, shifts = out
    return solutions, shifts, base
