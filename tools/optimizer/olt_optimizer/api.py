"""Shared optimization entry point — used by the CLI and by the HTTP service
(olt_optimizer/service.py), which is how the app reaches it.
"""

from .geometry import permissible_speed
from .optimize import baseline, binding_reason, capped, joint_optimize, uf_for, window_for
from .regelwerk import RegelwerkError, load_regelwerk, params_from_regelwerk
from .track_io import parse_groups, build_elements


def optimize_payload(track, corridor_cm=50.0, uf=130.0, uebergang="auto",
                     per_curve=False, maxiter=150, seed=1, target_element_idx=None,
                     v_max=None, regelwerk=None):
    """Optimize one track (dict in the tracks-export shape, scalar elements).

    v_max: the line's design speed [km/h], or None. A curve that reaches it is
    done — nothing above it counts, so the run neither trades the existing
    alignment away for speed nobody asked for nor keeps searching once its
    slowest curve has arrived.

    regelwerk: id of the regelwerk (AP R.2, see regelwerk.py) whose cant
    ceilings, ramp rule and buildability grid the run is held to — None for
    the default. Unknown ids raise ValueError, same as any other user error
    here; the id a run actually used travels back in the result, because a
    design three years from now is only reproducible if it says which rules
    it was drawn under.

    target_element_idx (element mode): index of an ARC element — only the
    window around its curve group is optimized (neighbour curves may be
    re-shaped so the shared straights can shift; they must not fall below
    their existing speed). Everything else keeps its geometry.

    Returns { elements, report, variant, vBestand, vBaseline, vNeu, shifts,
    skipped, regelwerk }.
    report: one row per arc with alt/neu values (radii m, cants mm, v km/h,
    offset cm). Raises ValueError with a readable message on unsupported
    topologies.
    """
    try:
        rw = load_regelwerk(regelwerk)
    except RegelwerkError as exc:
        raise ValueError(str(exc)) from None
    params = {"corridor": corridor_cm / 100.0, "uf": float(uf),
              "v_max": float(v_max) if v_max else None,
              **params_from_regelwerk(rw)}
    skipped = []
    try:
        groups = parse_groups(track, skipped=skipped)
    except SystemExit as exc:                      # parse errors are user errors
        raise ValueError(str(exc)) from None

    target_gi = None
    if target_element_idx is not None:
        target_gi = next((j for j, g in enumerate(groups)
                          if target_element_idx in g["arc_idxs"]), None)
        if target_gi is None:
            raise ValueError("Das gewählte Element gehört zu keinem optimierbaren Bogen.")

    def run(grps):
        if per_curve:
            window = window_for(grps, target_gi) if target_gi is not None else None
            sols = bas = baseline(grps, params, window=window, target_gi=target_gi)
            return sols, {}, bas
        return joint_optimize(grps, params, maxiter=maxiter, seed=seed, target_gi=target_gi)

    variants = []
    if uebergang in ("bestand", "auto"):
        variants.append(("Bestand", groups))
    if uebergang in ("bloss", "auto"):
        bloss_groups = [{**g, "types": ["bloss" if has else t for t, has in zip(g["types"], g["has_t"])]}
                        for g in groups]
        variants.append(("Bloss", bloss_groups))

    def score(sols):
        # Element mode: variants and headline numbers are judged by the target
        # group alone — the window neighbours are constraints, not objectives.
        if target_gi is not None:
            return capped(sols[target_gi]["v"], params) if sols[target_gi] else float("-inf")
        return min((capped(s["v"], params) for s in sols if s), default=float("-inf"))

    best = None
    for name, grps in variants:
        sols, shifts, bas = run(grps)
        v = score(sols)
        if best is None or v > best[0] + 1e-9:
            best = (v, name, grps, sols, shifts, bas)
    _, variant, groups_used, solutions, shifts, base = best

    report_gis = sorted(window_for(groups_used, target_gi)) if target_gi is not None \
        else range(len(groups_used))
    score_gis = [target_gi] if target_gi is not None else report_gis
    v_bestand = min(permissible_speed(a["r_alt"], a["u_alt"], uf_for(groups_used[j], params))
                    for j in score_gis for a in groups_used[j]["arcs"])
    v_base = min((base[j]["v"] for j in score_gis if base[j]), default=v_bestand)
    v_neu = min((solutions[j]["v"] for j in score_gis if solutions[j]), default=v_bestand)

    report = []
    for j in report_gis:
        g, sol = groups_used[j], solutions[j]
        # One reason per group, not per arc: v, offset and the ramps are group-
        # level facts (AP R.4) — a compound or S group's arcs share what binds
        # them, bar the cant ceiling, which binding_reason already names by arc.
        reason = binding_reason(g, sol, params) if sol is not None else None
        for i, arc in enumerate(g["arcs"]):
            v_alt = permissible_speed(arc["r_alt"], arc["u_alt"], uf_for(g, params))
            row = {
                "group": j + 1, "arc": i + 1, "arcs": len(g["arcs"]),
                "rAlt": arc["r_alt"], "uAlt": arc["u_alt"], "vAlt": v_alt,
                "changed": sol is not None,
                "target": target_gi is not None and j == target_gi,
            }
            if sol is not None:
                row.update({
                    "rNeu": sol["radii"][i], "uNeu": sol["us"][i],
                    "vNeu": permissible_speed(sol["radii"][i], sol["us"][i], uf_for(g, params)),
                    "offsetCm": sol["offset"] * 100.0,
                    "grund": reason,
                })
            report.append(row)

    return {
        "elements": build_elements(track, groups_used, solutions, shifts),
        "report": report,
        "variant": variant,
        "vBestand": v_bestand,
        "vBaseline": v_base,
        "vNeu": v_neu,
        "shifts": {str(k): v for k, v in shifts.items()},
        # Stretches the parser stepped over. They keep their geometry, and the
        # panel says so — half an answer handed back in silence is worse than
        # the refusal this used to be.
        "skipped": [{"from": a, "to": b, "why": why} for a, b, why in skipped],
        "regelwerk": rw["id"],
    }
