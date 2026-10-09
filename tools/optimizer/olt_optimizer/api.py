"""Shared optimization entry point — used by the CLI and by the HTTP service
(olt_optimizer/service.py), which is how the app reaches it.
"""

from .grenzen import DEFAULT_STUFE, STUFEN, grenzen_for
from .optimize import (
    arc_speed, baseline, bestand_speed, binding_reason, capped, joint_optimize, window_for,
)
from .regelwerk import DEFAULT_REGELWERK_ID, list_regelwerke
from .track_io import parse_groups, build_elements

VARIANTS = ("bestand", "bloss")


def run_params(corridor_cm=50.0, grenzwert=DEFAULT_STUFE, v_max=None, regelwerk=None):
    """The `params` a run reads: the corridor, the target speed and the limits
    of the catalogue at the level asked for (grenzen.py). Raises ValueError on
    an unknown regelwerk or level — both are user input."""
    wanted = regelwerk or DEFAULT_REGELWERK_ID
    if wanted not in {rw["id"] for rw in list_regelwerke()}:
        raise ValueError(f"unbekanntes Regelwerk: {wanted}")
    if grenzwert not in STUFEN:
        raise ValueError(f"unbekannte Grenzwertstufe: {grenzwert}")
    return {"corridor": corridor_cm / 100.0,
            "v_max": float(v_max) if v_max else None,
            "grenzen": grenzen_for(wanted, grenzwert)}


def variants_for(uebergang, grenzen):
    """The transition profiles a run tries: the ramps as they lie, and all of
    them Bloss — the latter only where the level admits a Bloss transition. In
    this app every ramp is straight, which LP.UB.02 calls a Sonderfall on a
    Bloss curve (ROADMAP, decision 47): at the Regelwert a run does not hand
    one out, at the Ermessensgrenze it does (grenzen.TOLERIERT). Asked for
    Bloss outright where it is not admitted, it says so instead of quietly
    answering something else."""
    if uebergang == "auto":
        return [name for name in VARIANTS if name != "bloss" or grenzen.forms["bloss"]]
    if uebergang not in VARIANTS:
        raise ValueError(f"unbekanntes Übergangsbogen-Profil: {uebergang}")
    if uebergang == "bloss" and not grenzen.forms["bloss"]:
        raise ValueError("Blossbögen schlägt ein Lauf nur an der Ermessensgrenze vor "
                         "(LP.UB.02: die Überhöhungsrampe ist in dieser App immer gerade).")
    return [uebergang]


def optimize_payload(track, corridor_cm=50.0, grenzwert=DEFAULT_STUFE, uebergang="auto",
                     per_curve=False, maxiter=150, seed=1, target_element_idx=None,
                     v_max=None, regelwerk=None):
    """Optimize one track (dict in the tracks-export shape, scalar elements).

    v_max: the line's design speed [km/h], or None. A curve that reaches it is
    done — nothing above it counts, so the run neither trades the existing
    alignment away for speed nobody asked for nor keeps searching once its
    slowest curve has arrived.

    regelwerk: id of the rule catalogue (src/core/constraints/, see regelwerk.py)
    the run is held to — None for the default, DB Ril 800.0110.
    grenzwert: the level of it — 'reg' (Regelwert: nothing the run proposes
    worse than a hint) or 'discretion' (Ermessensgrenze: nothing worse than a
    warning), see grenzen.py. Unknown ids and levels raise ValueError, same as
    any other user error here; both travel back in the result, because a
    design three years from now is only reproducible if it says which rules
    it was drawn under.

    target_element_idx (element mode): index of an ARC element — only the
    window around its curve group is optimized (neighbour curves may be
    re-shaped so the shared straights can shift; they must not fall below
    their existing speed). Everything else keeps its geometry.

    Returns { elements, report, variant, vBestand, vBaseline, vNeu, shifts,
    skipped, regelwerk, regelwerkVersion, grenzwert }.
    report: one row per arc with alt/neu values (radii m, cants mm, v km/h,
    offset cm). Raises ValueError with a readable message on unsupported
    topologies.
    """
    params = run_params(corridor_cm, grenzwert, v_max, regelwerk)
    grenzen = params["grenzen"]
    names = variants_for(uebergang, grenzen)
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
    if "bestand" in names:
        variants.append(("Bestand", groups))
    if "bloss" in names:
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
    v_bestand = min(bestand_speed(groups_used[j], params) for j in score_gis)
    v_base = min((base[j]["v"] for j in score_gis if base[j]), default=v_bestand)
    v_neu = min((solutions[j]["v"] for j in score_gis if solutions[j]), default=v_bestand)

    report = []
    for j in report_gis:
        g, sol = groups_used[j], solutions[j]
        # One reason per group, not per arc: v, offset and the ramps are group-
        # level facts (AP R.4) — a compound or S group's arcs share what binds
        # them, bar the cant ceiling, which binding_reason already names by arc.
        reason = binding_reason(g, sol, params) if sol is not None else None
        # A curvature jump holds the whole group; an arc on its own is as fast
        # as its radius and cant allow.
        v_group_alt = bestand_speed(g, params)
        for i, arc in enumerate(g["arcs"]):
            v_alt = min(arc_speed(g, arc["r_alt"], arc["u_alt"], params), v_group_alt)
            row = {
                "group": j + 1, "arc": i + 1, "arcs": len(g["arcs"]),
                "rAlt": arc["r_alt"], "uAlt": arc["u_alt"], "vAlt": v_alt,
                "changed": sol is not None,
                "target": target_gi is not None and j == target_gi,
            }
            if sol is not None:
                row.update({
                    "rNeu": sol["radii"][i], "uNeu": sol["us"][i],
                    "vNeu": min(arc_speed(g, sol["radii"][i], sol["us"][i], params),
                                sol["v"] if sol.get("jump") else float("inf")),
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
        "regelwerk": grenzen.regelwerk,
        "regelwerkVersion": grenzen.katalog.version,
        "grenzwert": grenzen.stufe,
    }
