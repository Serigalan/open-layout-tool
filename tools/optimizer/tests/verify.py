"""Verification harness (run: python tests/verify.py from tools/optimizer).

1. Geometry kernel against the reference values it was built to reproduce
   (generated with the app's JS kernel before AP 7.1 removed the JS optimizer).
2. n = 1 equivalence of the compound solver with the exact simple solver.
3. End-to-end: two-curve track and a compound curve (Korbbogen) → baseline →
   joint optimization; continuity, fixed end points, corridor, ramp rules,
   joint never below baseline.
4. Switch elements in a group: the tighter cant and deficiency limits (AP 1.1).
5. The rule catalogue a run is held to (src/constraints/db-ril-800-0110.json):
   its expression language, the limits it gives at Regelwert and
   Ermessensgrenze, and every proposal judged afterwards by a port of the
   app's own check (katalog_check.py) — independent of the bounds the run
   built to.
"""

import json
import math
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from olt_optimizer.geometry import (          # noqa: E402
    transition_shift, fit_curve_group, fit_compound_group, dir_of,
    permissible_speed, radius_for_speed, max_dist_to_polyline, snap_down, snap_up,
    fit_s_group, R_STEP, L_STEP, CANT_DEFICIENCY_COEFF, heading_coeffs,
)
from olt_optimizer.track_io import (          # noqa: E402
    parse_groups, build_elements, is_straight, _straight_element,
    _transition_element, _arc_element_seg, _element_ref_points,
)
from olt_optimizer.optimize import (        # noqa: E402
    arc_speed, baseline, bestand_speed, binding_reason, capped, joint_optimize, ramp_lengths,
    u_max_for, window_for, _bestand_solution, _interior_straights, _max_radius_for,
)
from olt_optimizer.api import optimize_payload, run_params, variants_for      # noqa: E402
from olt_optimizer.grenzen import Grenzen, GrenzenError, grenzen_for          # noqa: E402
from olt_optimizer.katalog import Katalog                                     # noqa: E402
from olt_optimizer.regelwerk import (                                         # noqa: E402
    CONSTRAINTS_DIR, RegelwerkError, list_regelwerke, load_katalog, load_regelwerk,
)
from olt_optimizer.ruleexpr import ExprError, comparison, eval_expr           # noqa: E402

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from katalog_check import check_track, new_indices                            # noqa: E402

# The constraint files live in the repo's own src/constraints/, not in the
# package: physics.json is the readable derivation this harness checks the
# kernel's literals against, and it ships with no install. Reaching for it
# across the repo root is deliberate — it is the one source, and a copy beside
# the kernel would be the drift this section exists to catch.
TOOLS_ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]

FAILED = 0


def ok(label, cond):
    global FAILED
    print(("PASS" if cond else "FAIL"), label)
    if not cond:
        FAILED += 1


close_pt = lambda a, b, tol=1e-6: math.hypot(a[0] - b[0], a[1] - b[1]) < tol   # noqa: E731
on_grid = lambda v, step: abs(v / step - round(v / step)) < 1e-6              # noqa: E731


REG = grenzen_for("db-ril-800-0110", "reg")
ERM = grenzen_for("db-ril-800-0110", "discretion")


def check_rules(label, old_els, new_els, grenzen=REG):
    """Every element the run proposed, judged by the catalogue the way the
    app's element table judges it: nothing worse than the level admits."""
    idx = new_indices(old_els, new_els)
    findings = check_track(grenzen.katalog, new_els, idx)
    bad = sorted({f for f in findings
                  if grenzen.katalog.rank(f[2]) > grenzen.max_rank and f[1] not in grenzen.toleriert})
    ok(f"{label}: Regelkatalog ({grenzen.stufe}) für {len(idx)} neue Elemente eingehalten"
       f" ({bad[:4] or 'kein Befund darüber'})", idx and not bad)
    return findings


def check_chain(els, label):
    max_gap = max(math.hypot(a["endNode"][0] - b["startNode"][0], a["endNode"][1] - b["startNode"][1])
                  for a, b in zip(els, els[1:]))
    max_kink = max(abs((((a.get("endBearing", a["bearing"]) - b["bearing"]) + 540) % 360) - 180)
                   for a, b in zip(els, els[1:]))
    ok(f"{label}: Anschlüsse dicht (max {max_gap * 1000:.2e} mm)", max_gap < 1e-6)
    ok(f"{label}: tangentenstetig (max {max_kink:.2e}°)", max_kink < 1e-6)


def independent_offset(old_els, new_els):
    ref = []
    for el in old_els:
        part = _element_ref_points(el)
        ref.extend(part[1:] if ref else part)
    pts = []
    for el in new_els:
        pts.extend(_element_ref_points(el))
    return max_dist_to_polyline(pts, ref)


# ── 1) Kernel vs. JS-Referenz ────────────────────────────────────────────────
p, t, phi = transition_shift(60, 800, "clothoid")
ok("transitionShift Klothoide == JS (1e-9)",
   abs(p - 0.1874905834282572) < 1e-9 and abs(t - 29.99859380493031) < 1e-9 and phi == 0.0375)
p, t, phi = transition_shift(70, 800, "bloss")
ok("transitionShift Bloss == JS (1e-9)",
   abs(p - 0.15311799746666566) < 1e-9 and abs(t - 34.99893667338733) < 1e-9 and phi == 0.04375)

B1, B2 = 40.0, 65.0
P1 = (500000.0, 5600000.0)
D1 = dir_of(B1)
VERTEX = (P1[0] + 600 * D1[0], P1[1] + 600 * D1[1])
D2 = dir_of(B2)
P2 = (VERTEX[0] + 600 * D2[0], VERTEX[1] + 600 * D2[1])

fit = fit_curve_group(P1, D1, P2, D2, 800, 60, 70, "clothoid", "bloss")
REF = {
    "cl_start": (500252.4133371916, 5600300.814501417),
    "cl_end": (500578.2357312029, 5600549.420344572),
    "arc_start": (500291.54964623053, 5600346.288662639),
    "arc_end": (500515.1934940613, 5600519.0096806055),
    "sweep": -0.3550823129988734,
    "signed_r": 800,
}
ok("fitCurveGroup Punkte == JS (1e-6 m)",
   close_pt(fit["cl_start"], REF["cl_start"]) and close_pt(fit["cl_end"], REF["cl_end"])
   and close_pt(fit["arc_start"], REF["arc_start"]) and close_pt(fit["arc_end"], REF["arc_end"]))
ok("fitCurveGroup Sweep/Seite == JS",
   abs(fit["sweep"] - REF["sweep"]) < 1e-9 and fit["signed_r"] == REF["signed_r"])

# ── 2) n=1-Äquivalenz: Compound-Solver == exakter Einzelbogen-Solver ─────────
cfit = fit_compound_group(P1, D1, B1, P2, D2, B2, [800], [], [60, 70], ["clothoid", "bloss"])
arc_seg = next(s for s in cfit["segments"] if s["kind"] == "arc")
ok("Compound n=1: Tangentenpunkte == fitCurveGroup (1e-6 m)",
   close_pt(cfit["cl_start"], fit["cl_start"]) and close_pt(cfit["cl_end"], fit["cl_end"]))
ok("Compound n=1: Bogenpunkte == fitCurveGroup (1e-6 m)",
   close_pt(arc_seg["start"], fit["arc_start"]) and close_pt(arc_seg["end"], fit["arc_end"]))
ok("Compound n=1: Sweep == fitCurveGroup",
   abs(arc_seg["sweep"] - abs(fit["sweep"])) < 1e-9 and arc_seg["signed_r"] == fit["signed_r"])

# ── 3) Track mit zwei einfachen Bögen und gemeinsamer Zwischengerade ─────────
EPSG = 25832


def build_from_fit(cfit, cants, p_start, p_end, speed=100):
    els = [_straight_element(p_start, cfit["cl_start"], EPSG, speed)]
    arc_no = 0
    for seg in cfit["segments"]:
        if seg["kind"] == "transition":
            els.append(_transition_element(seg["start"], seg["bearing"], seg["L"],
                                           seg["r1"], seg["r2"], seg["type"], EPSG, speed))
        else:
            els.append(_arc_element_seg(seg, EPSG, speed, cants[arc_no]))
            arc_no += 1
    els.append(_straight_element(cfit["cl_end"], p_end, EPSG, speed))
    return els


B3 = 40.0
D3 = dir_of(B3)
V2 = (VERTEX[0] + 700 * D2[0], VERTEX[1] + 700 * D2[1])
P3 = (V2[0] + 500 * D3[0], V2[1] + 500 * D3[1])

fit1 = fit_compound_group(P1, D1, B1, V2, D2, B2, [700], [], [60, 60], ["clothoid", "clothoid"])
fit2 = fit_compound_group(VERTEX, D2, B2, P3, D3, B3, [700], [], [60, 60], ["clothoid", "clothoid"])
mid = fit1["cl_end"]
els1 = build_from_fit(fit1, [80], P1, mid)
els2 = build_from_fit(fit2, [80], mid, P3)
elements = els1[:-1] + [_straight_element(fit1["cl_end"], fit2["cl_start"], EPSG, 100)] + els2[1:]
track = {"id": "py1", "name": "test.001", "epsg": EPSG, "elements": elements}
check_chain(elements, "Seed-Track (2 Bögen)")

groups = parse_groups(track)
ok("Parser: 2 Gruppen, gemeinsame Zwischengerade",
   len(groups) == 2 and groups[0]["exit_idx"] == groups[1]["entry_idx"])

params = run_params(50.0)
base = baseline(groups, params)
v_alt = min(bestand_speed(g, params) for g in groups)
v_base = min(s["v"] for s in base)
print(f"   Bestand {v_alt:.1f} km/h → Baseline {v_base:.1f} km/h")
ok("Baseline verbessert Engpass-v", v_base > v_alt + 1)
ok("Baseline: Korridor eingehalten", all(s["offset"] <= 0.5 + 1e-6 for s in base))
check_rules("Baseline", elements, build_elements(track, groups, base, {}))

solutions, shifts, _ = joint_optimize(groups, params, maxiter=40, seed=1)
v_joint = min(s["v"] for s in solutions)
print(f"   Joint {v_joint:.1f} km/h | Verschiebungen: "
      + (", ".join(f"#{k}: {v * 100:+.1f} cm" for k, v in shifts.items()) or "keine"))
ok("Joint ≥ Baseline", v_joint >= v_base - 1e-6)
ok("Joint: Korridor eingehalten", all(s["offset"] <= 0.5 + 1e-6 for s in solutions))
ok("Joint: u ≤ 160 im 5-mm-Raster", all(
    u <= 160 and (abs(u / 5 - round(u / 5)) < 1e-9 or u == a["u_alt"])
    for g, s in zip(groups, solutions) for a, u in zip(g["arcs"], s["us"])))
ok("Joint: Radien in ganzen Metern", all(
    on_grid(r, R_STEP) for s in solutions for r in s["radii"]))
ok("Joint: Rampenlängen im 10-cm-Raster", all(
    on_grid(length, L_STEP) for s in solutions for length in s["trans_l"]))

new_els = build_elements(track, groups, solutions, shifts)
check_chain(new_els, "Optimierter Track")
ok("Optimierter Track: Radien ganze Meter", all(
    on_grid(abs(el["radius"]), R_STEP) for el in new_els if el["elementType"] == 1))
ok("Optimierter Track: Übergangsbogenlängen im 10-cm-Raster", all(
    on_grid(el["length"], L_STEP) for el in new_els if el["elementType"] == 2))
ok("Endpunkte fix", tuple(new_els[0]["startNode"]) == P1
   and math.hypot(new_els[-1]["endNode"][0] - P3[0], new_els[-1]["endNode"][1] - P3[1]) < 1e-9)
check_rules("Optimierter Track", elements, new_els)
ok("Entwurfsgeschwindigkeit der neuen Elemente im 5-km/h-Raster",
   all(el["speed"] % 5 == 0 for el in (new_els[i] for i in new_indices(elements, new_els))
       if el["elementType"] != 0))
measured = independent_offset(elements, new_els)
ok(f"unabhängige Abrückung ≤ 51 cm ({measured * 100:.1f} cm)", measured <= 0.51)

# ── 3b) Profilwechsel auf Bloss ─────────────────────────────────────────────
# Die Rampe ist in dieser App immer gerade, und LP.UB.02 nennt einen Blossbogen
# darauf einen Sonderfall. Am Regelwert bietet ein Lauf ihn deshalb nicht an;
# an der Ermessensgrenze schon (Entscheidung 57) — Länge und Neigung halten
# dort LP.UB.04/06/07/08 ein, nur LP.UB.02 wird durchgelassen.
ok("Bloss: am Regelwert nicht, an der Ermessensgrenze schon",
   not REG.forms["bloss"] and ERM.forms["bloss"] and REG.forms["clothoid"])
ok("Bloss: durchgelassen wird an der Ermessensgrenze nur LP.UB.02",
   REG.toleriert == set() and ERM.toleriert == {"LP.UB.02"})
ok("Bloss: 'auto' rechnet am Regelwert nur den Bestand, an der Ermessensgrenze beide",
   variants_for("auto", REG) == ["bestand"] and variants_for("auto", ERM) == ["bestand", "bloss"])
try:
    variants_for("bloss", REG)
    ok("Bloss: am Regelwert ausdrücklich verlangt → abgelehnt, mit Grund", False)
except ValueError as exc:
    ok("Bloss: am Regelwert ausdrücklich verlangt → abgelehnt, mit Grund", "LP.UB.02" in str(exc))
bloss_groups = [{**g, "types": ["bloss" if has else t for t, has in zip(g["types"], g["has_t"])]}
                for g in groups]
b_base = baseline(bloss_groups, params)
v_bloss = min(s["v"] for s in b_base)
print(f"   Baseline Bestand-Typen {v_base:.1f} km/h | alle Bloss {v_bloss:.1f} km/h")
ok("Bloss-Variante (Kernel): Rampen nach LP.UB.04, kürzer als die Klothoide", all(
    b["trans_l"][0] <= c["trans_l"][0] + 1e-9 for b, c in zip(b_base, base) if b["us"] == c["us"]))
b_els = build_elements(track, bloss_groups, b_base, {})
ok("Bloss-Variante: Elemente tragen transitionType bloss",
   all(el.get("transitionType") == "bloss" for el in b_els if el["elementType"] == 2))
check_chain(b_els, "Bloss-Variante")
ok("Bloss-Variante: v nicht schlechter als Bestand-Typen", v_bloss >= v_base - 1e-9)

# ── 4) Korbbogen: zwei Bögen gleicher Richtung mit Zwischen-ÜB ───────────────
KB2 = 62.0
DK2 = dir_of(KB2)
KP2 = (VERTEX[0] + 900 * DK2[0], VERTEX[1] + 900 * DK2[1])
kfit = fit_compound_group(P1, D1, B1, KP2, DK2, KB2, [900, 600], [0.10], [60, 40, 60],
                          ["clothoid", "clothoid", "clothoid"])
ok("Korbbogen-Seed-Fit existiert", kfit is not None and len(kfit["segments"]) == 5)
k_els = build_from_fit(kfit, [60, 100], P1, KP2)
k_track = {"id": "py2", "name": "korb.001", "epsg": EPSG, "elements": k_els}
check_chain(k_els, "Korbbogen-Seed")

k_groups = parse_groups(k_track)
ok("Parser: 1 Gruppe mit 2 Bögen", len(k_groups) == 1 and len(k_groups[0]["arcs"]) == 2
   and k_groups[0]["has_t"] == [True, True, True])
ok("Sweeps aus Bestand rekonstruiert",
   abs(k_groups[0]["arcs"][0]["sweep_alt"] - 0.10) < 1e-6
   and abs(k_groups[0]["arcs"][1]["sweep_alt"] - kfit["thetas"][1]) < 1e-6)

k_sols, k_shifts, k_base = joint_optimize(k_groups, params, maxiter=60, seed=1)
k_sol = k_sols[0]
v_k_alt = bestand_speed(k_groups[0], params)
print(f"   Korbbogen: Bestand {v_k_alt:.1f} → Joint {k_sol['v']:.1f} km/h | "
      f"r {[round(a['r_alt']) for a in k_groups[0]['arcs']]} → {[round(r, 1) for r in k_sol['radii']]} | "
      f"u {[a['u_alt'] for a in k_groups[0]['arcs']]} → {k_sol['us']}")
ok("Korbbogen: v verbessert", k_sol["v"] > v_k_alt + 1)
ok("Korbbogen: u im 5-mm-Raster", all(
    u <= 160 and (abs(u / 5 - round(u / 5)) < 1e-9 or u == a["u_alt"])
    for a, u in zip(k_groups[0]["arcs"], k_sol["us"])))
ok("Korbbogen: Korridor eingehalten", k_sol["offset"] <= 0.5 + 1e-6)
ok("Korbbogen: Zwischenrampe mindestens nach LP.UB.03 (10·v·Δu)",
   k_sol["trans_l"][1] >= 10 * k_sol["v_design"] * abs(k_sol["us"][1] - k_sol["us"][0]) / 1000 - 1e-9)

k_new = build_elements(k_track, k_groups, k_sols, k_shifts)
check_chain(k_new, "Optimierter Korbbogen")
ok("Korbbogen: Endpunkte fix", tuple(k_new[0]["startNode"]) == P1
   and math.hypot(k_new[-1]["endNode"][0] - KP2[0], k_new[-1]["endNode"][1] - KP2[1]) < 1e-9)
check_rules("Korbbogen", k_els, k_new)
k_measured = independent_offset(k_els, k_new)
ok(f"Korbbogen: unabhängige Abrückung ≤ 51 cm ({k_measured * 100:.1f} cm)", k_measured <= 0.51)
ok("Korbbogen: beide Bögen gleiche Richtung",
   all(seg["signed_r"] * k_new[2]["radius"] > 0 for seg in k_sol["fit"]["segments"] if seg["kind"] == "arc"))

# ── 4b) Korbbogen ohne Zwischen-ÜB: Bogen stößt direkt an Bogen ─────────────
# Ohne Rampe zwischen den Bögen gibt es keinen Weg, die Überhöhung zu ändern —
# ein Sprung ohne Rampe wäre ein Fehler im Gleis, kein Optimierungsergebnis.
nfit = fit_compound_group(P1, D1, B1, KP2, DK2, KB2, [900, 600], [0.10], [60, 0, 60],
                          ["clothoid", "clothoid", "clothoid"])
ok("Direkt-Korbbogen: Fit ohne Zwischen-ÜB existiert",
   nfit is not None and [s["kind"] for s in nfit["segments"]]
   == ["transition", "arc", "arc", "transition"])
n_els = build_from_fit(nfit, [80, 80], P1, KP2)
n_track = {"id": "py2b", "name": "korb_direkt.001", "epsg": EPSG, "elements": n_els}
check_chain(n_els, "Direkt-Korbbogen-Seed")
n_groups = parse_groups(n_track)
ok("Direkt-Korbbogen: eine Gruppe, zwei Bögen, mittlere Rampe fehlt",
   len(n_groups) == 1 and len(n_groups[0]["arcs"]) == 2
   and n_groups[0]["has_t"] == [True, False, True])
n_sols, n_shifts, _ = joint_optimize(n_groups, params, maxiter=25, seed=1)
ok("Direkt-Korbbogen: Gruppe wird nicht gesperrt", n_sols[0] is not None)
ok("Direkt-Korbbogen: Überhöhung bleibt, wo keine Rampe sie tragen kann",
   n_sols[0]["us"] == [80.0, 80.0])
n_new = build_elements(n_track, n_groups, n_sols, n_shifts)
check_chain(n_new, "Direkt-Korbbogen optimiert")
n_cants = [el["cant"] for el in n_new if el["elementType"] == 1]
ok("Direkt-Korbbogen: kein Überhöhungssprung zwischen den Bögen",
   len(n_cants) == 2 and abs(n_cants[0] - n_cants[1]) < 1e-9)

# ── 4c) Dreibogiger Korbbogen — der Bestand muss reproduzierbar bleiben ──────
# Ein Bestandslauf fittet mit den Rampen, die daliegen. Würde er sie aus der
# Rampenregel neu bestimmen, läge die „Bestands"-Lage nicht mehr dort, wo das
# Gleis liegt — bei drei Bögen reichte das, um den Korridor zu reißen und die
# Gruppe zu sperren. Gesperrt heißt: sie fällt aus der Optimierung und nagelt
# obendrein die Geraden neben sich fest.
TB3 = 75.0
TD3 = dir_of(TB3)
TP3 = (VERTEX[0] + 1100 * TD3[0], VERTEX[1] + 1100 * TD3[1])
tfit = fit_compound_group(P1, D1, B1, TP3, TD3, TB3, [1000, 700, 500], [0.10, 0.12],
                          [60, 40, 40, 60], ["clothoid"] * 4)
ok("Dreibogen: Seed-Fit existiert",
   tfit is not None and sum(1 for s in tfit["segments"] if s["kind"] == "arc") == 3)
t_els = build_from_fit(tfit, [50, 70, 100], P1, TP3)
t_track = {"id": "py2c", "name": "korb3.001", "epsg": EPSG, "elements": t_els}
check_chain(t_els, "Dreibogen-Seed")
t_groups = parse_groups(t_track)
ok("Dreibogen: eine Gruppe mit drei Bögen",
   len(t_groups) == 1 and len(t_groups[0]["arcs"]) == 3)
t_bestand = _bestand_solution(t_groups[0], params)
ok("Dreibogen: Bestand ist reproduzierbar", t_bestand is not None)
ok(f"Dreibogen: Bestandslage trifft das Gleis ({(t_bestand or {}).get('offset', 9) * 100:.3f} cm)",
   t_bestand is not None and t_bestand["offset"] < 1e-4)
t_sols, t_shifts, _ = joint_optimize(t_groups, params, maxiter=25, seed=1)
ok("Dreibogen: Gruppe wird nicht gesperrt", t_sols[0] is not None)
v_t_alt = bestand_speed(t_groups[0], params)
ok("Dreibogen: nie schlechter als der Bestand", t_sols[0]["v"] >= v_t_alt - 1e-6)
t_new = build_elements(t_track, t_groups, t_sols, t_shifts)
check_chain(t_new, "Dreibogen optimiert")
ok("Dreibogen: alle drei Bögen gleiche Richtung",
   len({el["radius"] > 0 for el in t_new if el["elementType"] == 1}) == 1)
# Im weiteren Korridor bewegt sich die Gruppe auch wirklich — sonst sagte der
# Test oben nur, dass nichts passiert.
t_wide, _, _ = joint_optimize(parse_groups(t_track), run_params(500.0), maxiter=40, seed=1)
print(f"   Dreibogen: Bestand {v_t_alt:.1f} → 50 cm {t_sols[0]['v']:.1f} → 5 m {t_wide[0]['v']:.1f} km/h")
ok("Dreibogen: im weiten Korridor wird er schneller", t_wide[0]["v"] > v_t_alt + 1)

# ── 5) Element-Modus: Fenster um den gewählten Bogen ─────────────────────────
# Track mit drei Bögen; Ziel = erster Bogen → Fenster {Gruppe 1, 2}, Gruppe 3
# bleibt gesperrt. Nachbarn dürfen umgeformt werden (gemeinsame Gerade darf
# wandern), aber nicht unter ihre Bestands-Geschwindigkeit fallen.
B4 = 70.0
D4 = dir_of(B4)
V3 = (V2[0] + 900 * D3[0], V2[1] + 900 * D3[1])
P4 = (V3[0] + 500 * D4[0], V3[1] + 500 * D4[1])
fit3 = fit_compound_group(V2, D3, B3, P4, D4, B4, [700], [], [60, 60], ["clothoid", "clothoid"])
els3 = build_from_fit(fit3, [80], fit2["cl_end"], P4)
elements3 = (elements[:-1]
             + [_straight_element(fit2["cl_end"], fit3["cl_start"], EPSG, 100)]
             + els3[1:])
track3 = {"id": "py3", "name": "fenster.001", "epsg": EPSG, "elements": elements3}
check_chain(elements3, "Seed-Track (3 Bögen)")

w_groups = parse_groups(track3)
ok("Parser: 3 Gruppen mit gemeinsamen Geraden", len(w_groups) == 3
   and w_groups[0]["exit_idx"] == w_groups[1]["entry_idx"]
   and w_groups[1]["exit_idx"] == w_groups[2]["entry_idx"])
ok("window_for: Ziel + Nachbarn über gemeinsame Geraden",
   window_for(w_groups, 0) == {0, 1} and window_for(w_groups, 1) == {0, 1, 2}
   and window_for(w_groups, 2) == {1, 2})

w_base = baseline(w_groups, params, window={0, 1}, target_gi=0)
ok("Fenster-Baseline: Gruppe 3 gesperrt, Nachbar auf Bestand",
   w_base[2] is None and w_base[1] is not None
   and abs(w_base[1]["radii"][0] - w_groups[1]["arcs"][0]["r_alt"]) < 1e-9)

TARGET_IDX = w_groups[0]["arc_idxs"][0]
res = optimize_payload(track3, corridor_cm=50.0, uebergang="bestand",
                       maxiter=40, seed=1, target_element_idx=TARGET_IDX)
rows = res["report"]
t_rows = [r for r in rows if r["target"]]
n_rows = [r for r in rows if not r["target"]]
ok("Report: nur Fenster-Gruppen, Ziel markiert",
   {r["group"] for r in rows} == {1, 2} and len(t_rows) == 1 and t_rows[0]["group"] == 1)
v0_alt = bestand_speed(w_groups[0], params)
v0_base = w_base[0]["v"]
print(f"   Ziel-Bogen: Bestand {v0_alt:.1f} → Baseline {v0_base:.1f} "
      f"→ Fenster {t_rows[0]['vNeu']:.1f} km/h | Verschiebungen: "
      + (", ".join(f"#{k}: {float(v) * 100:+.1f} cm" for k, v in res["shifts"].items()) or "keine"))
ok("Ziel-Bogen: v ≥ Einzelbogen-Baseline", t_rows[0]["vNeu"] >= v0_base - 1e-6)
ok("Ziel-Bogen: v gegenüber Bestand verbessert", t_rows[0]["vNeu"] > v0_alt + 1)
ok("Kopfzahlen beziehen sich auf den Ziel-Bogen",
   abs(res["vBestand"] - v0_alt) < 1e-9 and abs(res["vNeu"] - t_rows[0]["vNeu"]) < 1e-9)
ok("Nachbar: v nicht unter Bestand",
   all(r.get("vNeu", r["vAlt"]) >= r["vAlt"] - 0.05 for r in n_rows))
ok("Verschiebung nur auf der Fenster-Geraden (Rest gesperrt)",
   set(res["shifts"]) <= {str(w_groups[0]["exit_idx"])})

new3 = res["elements"]
check_chain(new3, "Fenster-optimierter Track")
ok("Fenster: Endpunkte fix", tuple(new3[0]["startNode"]) == P1
   and math.hypot(new3[-1]["endNode"][0] - P4[0], new3[-1]["endNode"][1] - P4[1]) < 1e-9)
locked_idxs = w_groups[2]["arc_idxs"] + [k for k in w_groups[2]["t_idxs"] if k is not None]
ok("Gesperrte Gruppe 3 unverändert", len(new3) == len(elements3) and all(
    new3[k]["startNode"] == elements3[k]["startNode"]
    and new3[k]["endNode"] == elements3[k]["endNode"]
    and new3[k].get("radius") == elements3[k].get("radius")
    for k in locked_idxs))
check_rules("Fenster-optimierter Track", elements3, new3)
w_measured = independent_offset(elements3, new3)
ok(f"Fenster: unabhängige Abrückung ≤ 51 cm ({w_measured * 100:.1f} cm)", w_measured <= 0.51)

try:
    optimize_payload(track3, target_element_idx=w_groups[0]["entry_idx"])
    picked_err = None
except ValueError as exc:
    picked_err = str(exc)
ok("Gerade als Ziel → verständlicher Fehler", picked_err is not None and "Bogen" in picked_err)

# ── 6) Weichenelemente in der Gruppe: engere u/uf-Grenzen (AP 1.1) ───────────
# Derselbe Seed-Track einmal als reine Strecke und einmal mit einer Weichenmarke
# am Bogen der ersten Gruppe. Erwartet: die Marke bindet nur die Gruppe, in deren
# Bogenteil sie liegt, und dort sinken u auf 100 mm und uf auf 110 mm.
SW_ARC = groups[0]["arc_idxs"][0]
sw_elements = [{**el, **({"switchBranch": True} if i == SW_ARC else {})}
               for i, el in enumerate(elements)]
sw_groups = parse_groups({**track, "id": "py-weiche", "elements": sw_elements})
ok("Weiche: nur die Gruppe mit der Marke im Bogenteil zählt als Weichengruppe",
   sw_groups[0]["on_switch"] and not sw_groups[1]["on_switch"])

# Die Randgeraden tragen keine eigene Überhöhung und sind zwischen benachbarten
# Gruppen geteilt — eine Marke dort darf keine von beiden binden.
edge_elements = [{**el, **({"switchBranch": True} if i == groups[0]["entry_idx"] else {})}
                 for i, el in enumerate(elements)]
edge_groups = parse_groups({**track, "id": "py-weiche-rand", "elements": edge_elements})
ok("Weiche: Marke auf einer Randgeraden bindet keine Gruppe",
   not any(g["on_switch"] for g in edge_groups))

ok("Weiche: u_max 100 mm statt 160 (LP.KB.05/01), u_f 110 statt 130 (LP.KB.06/02)",
   u_max_for(sw_groups[0], params) == 100.0 and REG.uf_max(100.0, True) == 110.0
   and u_max_for(sw_groups[1], params) == 160.0 and REG.uf_max(100.0, False) == 130.0)
ok("Weiche: an der Ermessensgrenze 120 mm (LP.KB.05), u_f bleibt 110 (LP.KB.06 kennt keine)",
   ERM.u_max(True) == 120.0 and ERM.uf_max(100.0, True) == 110.0)
ok("Weiche: die Bogengeschwindigkeit rechnet mit 110 mm",
   abs(arc_speed(sw_groups[0], 700.0, 0.0, params) - permissible_speed(700.0, 0.0, 110.0)) < 1e-9)

sw_base = baseline(sw_groups, params)
print(f"   Weichengruppe: u {sw_base[0]['us']} bei v {sw_base[0]['v']:.1f} km/h | "
      f"Streckengruppe: u {base[0]['us']} bei v {base[0]['v']:.1f} km/h")
ok("Weiche: Baseline überhöht höchstens 100 mm", all(u <= 100.0 for u in sw_base[0]["us"]))
ok("Weiche: gleiche Geometrie, aber weniger v als die Streckengruppe",
   sw_base[0]["v"] < base[0]["v"])

sw_sols, _, _ = joint_optimize(sw_groups, params, maxiter=40, seed=1)
ok("Weiche: auch die Joint-Optimierung bleibt unter 100 mm",
   all(u <= 100.0 for u in sw_sols[0]["us"]))
# Am Regelwert (10·v·Δu) lohnt die volle Weichenüberhöhung hier nicht mehr —
# ihre Rampe kostet mehr Radius, als sie bringt. Der Grund wird deshalb an
# einer Lösung geprüft, die an der Decke steht.
_sw_at_cap = {**sw_base[0], "us": [100.0], "jump": None, "offset": 0.1}
ok("Grund (AP R.4): an der Weichengrenze steht die Weiche, nicht die Strecke",
   binding_reason(sw_groups[0], _sw_at_cap, params) == {"regel": "weiche", "arc": 1, "ist": 100.0, "soll": 100.0}
   and binding_reason(groups[0], {**base[0], "us": [100.0], "jump": None, "offset": 0.1},
                      params)["regel"] != "weiche")
ok("Grund: im 50-cm-Korridor bindet bei der Streckengruppe der Korridor",
   binding_reason(groups[0], base[0], params)["regel"] == "korridor")

# Ein Bestandswert über der Grenze ist ein Befund für die Elementtabelle, keine
# Rechenreserve: er wird weder angehoben noch stillschweigend gekappt.
over_elements = [{**el, **({"switchBranch": True, "cant": 120.0} if i == SW_ARC else {})}
                 for i, el in enumerate(elements)]
over_groups = parse_groups({**track, "id": "py-weiche-ueber", "elements": over_elements})
over_base = baseline(over_groups, params)
ok("Weiche: Bestandsüberhöhung über der Grenze bleibt unverändert stehen",
   over_groups[0]["arcs"][0]["u_alt"] == 120.0
   and (over_base[0] is None or over_base[0]["us"] == [120.0]))

# ── 7) Track, der im Bogen beginnt oder endet ────────────────────────────────
# Gelesen wird die Strecke zwischen der ersten und der letzten Geraden. Ein
# Randbogen hat außen keine Gerade, zwischen die er zu passen wäre — er bleibt
# liegen, und die Optimierung fängt an der Geraden dahinter an.
full = elements3                      # G ÜB B ÜB G ÜB B ÜB G ÜB B ÜB G (3 Bögen)
EDGE = {
    "beginnt im Bogen": full[1:],
    "endet im Bogen": full[:-1],
    "beidseitig im Bogen": full[1:-1],
}
for label, sub in EDGE.items():
    e_track = {**track3, "id": f"py-rand-{label}", "elements": [dict(el) for el in sub]}
    e_groups = parse_groups(e_track)
    ok(f"{label}: wird angenommen", len(e_groups) >= 1)
    ok(f"{label}: liest erst ab der ersten Geraden",
       is_straight(sub[e_groups[0]["entry_idx"]]) and is_straight(sub[e_groups[-1]["exit_idx"]])
       and all(not is_straight(el) for el in sub[:e_groups[0]["entry_idx"]])
       and all(not is_straight(el) for el in sub[e_groups[-1]["exit_idx"] + 1:]))
    e_res = optimize_payload(e_track, corridor_cm=50.0, uebergang="bestand",
                             maxiter=25, seed=1)
    e_new = e_res["elements"]
    ok(f"{label}: kein Element geht verloren", len(e_new) == len(sub))
    check_chain(e_new, label)
    ok(f"{label}: Endpunkte fix",
       close_pt(e_new[0]["startNode"], sub[0]["startNode"])
       and close_pt(e_new[-1]["endNode"], sub[-1]["endNode"]))
    # Der ungelesene Randbogen ist nicht nur angeschlossen, er ist derselbe.
    head, tail = e_groups[0]["entry_idx"], e_groups[-1]["exit_idx"]
    ok(f"{label}: der Randbogen bleibt, wie er liegt",
       all(close_pt(a["startNode"], b["startNode"]) and close_pt(a["endNode"], b["endNode"])
           for a, b in zip(e_new[:head], sub[:head]))
       and all(close_pt(a["startNode"], b["startNode"]) and close_pt(a["endNode"], b["endNode"])
               for a, b in zip(e_new[tail + 1:], sub[tail + 1:])))
    ok(f"{label}: die gelesene Strecke wird schneller",
       e_res["vNeu"] > e_res["vBestand"] + 1)

# Die Randgeraden der gelesenen Strecke dürfen nicht wandern — an ihnen hängt,
# was nicht gelesen wurde.
head_track = {**track3, "id": "py-rand-fest", "elements": [dict(el) for el in full[1:]]}
head_groups = parse_groups(head_track)
ok("Randgerade der gelesenen Strecke ist keine Verschiebegerade",
   head_groups[0]["entry_idx"] not in _interior_straights(head_groups)
   and head_groups[-1]["exit_idx"] not in _interior_straights(head_groups))

for label, els_bad in (("nur eine Gerade", [dict(full[0])]),
                       ("gar keine Gerade", [dict(el) for el in full[1:4]])):
    try:
        parse_groups({**track3, "elements": els_bad})
        ok(f"{label} → abgelehnt", False)
    except SystemExit as exc:
        ok(f"{label} → abgelehnt mit lesbarem Satz", "Geraden" in str(exc))


# ── 8) Das Raster: was ein Lauf vorschlägt, ist baubar ───────────────────────
# Radien in ganzen Metern, Längen in 10 cm — die Schritte, in denen entworfen
# wird. Der Bestand wird davon nicht angefasst: er ist eine Tatsache, kein
# Vorschlag, und eine krumme Bestandszahl bleibt krumm.
ok("snap_down/snap_up lassen Rasterwerte liegen",
   snap_up(60.0, L_STEP) == 60.0 and snap_down(60.0, L_STEP) == 60.0
   and snap_down(700.0, R_STEP) == 700.0)
ok("snap_up rundet auf, snap_down ab",
   snap_up(60.01, L_STEP) == 60.1 and snap_down(60.09, L_STEP) == 60.0
   and snap_down(712.34, R_STEP) == 712.0 and snap_up(712.01, R_STEP) == 713.0)

# Ein Bogen mit krummem Bestandsradius und krummer Rampe.
ODD_R, ODD_L = 712.34, 63.27
odd_fit = fit_compound_group(P1, D1, B1, V2, D2, B2, [ODD_R], [], [ODD_L, ODD_L],
                             ["clothoid", "clothoid"])
# Die Schlussgerade läuft auf der Ausgangstangente weiter, sonst knickt sie.
odd_end = (odd_fit["cl_end"][0] + 400 * D2[0], odd_fit["cl_end"][1] + 400 * D2[1])
odd_els = build_from_fit(odd_fit, [77.0], P1, odd_end)
odd_track = {"id": "py-raster", "name": "raster.001", "epsg": EPSG, "elements": odd_els}
odd_groups = parse_groups(odd_track)
ok("krummer Bestand wird eingelesen, wie er ist",
   abs(odd_groups[0]["arcs"][0]["r_alt"] - ODD_R) < 1e-9
   and abs(odd_groups[0]["t_len"][0] - ODD_L) < 1e-6)
odd_bestand = _bestand_solution(odd_groups[0], params)
ok("Bestandslösung rundet den krummen Radius nicht",
   odd_bestand is not None and abs(odd_bestand["radii"][0] - ODD_R) < 1e-9)
ok("Bestandslösung rundet die krumme Rampe nicht",
   odd_bestand is not None and abs(odd_bestand["trans_l"][0] - ODD_L) < 1e-6)

odd_res = optimize_payload(odd_track, corridor_cm=50.0, uebergang="bestand",
                           maxiter=25, seed=1)
odd_new = odd_res["elements"]
ok("Vorschlag aus krummem Bestand: Radien wieder ganze Meter", all(
    on_grid(abs(el["radius"]), R_STEP) for el in odd_new if el["elementType"] == 1))
ok("Vorschlag aus krummem Bestand: Rampen wieder im 10-cm-Raster", all(
    on_grid(el["length"], L_STEP) for el in odd_new if el["elementType"] == 2))
check_chain(odd_new, "Raster-Track")

# Die Rampenregel darf am Raster nicht zerbrechen: aufgerundet erfüllt sie sich
# weiter, abgerundet nicht.
odd_base = baseline(odd_groups, params)
check_rules("Rampenregeln trotz Rasterung", odd_els, build_elements(odd_track, odd_groups, odd_base, {}))


# ── 9) Zielgeschwindigkeit: oberhalb davon ist nichts mehr zu holen ──────────
ok("radius_for_speed kehrt permissible_speed um", all(
    abs(permissible_speed(radius_for_speed(v, u, 130.0), u, 130.0) - v) < 1e-9
    for v in (100.0, 160.0, 230.0) for u in (0.0, 60.0, 150.0)))

v_free = optimize_payload(track, corridor_cm=50.0, uebergang="bestand",
                          maxiter=40, seed=1)
V_TARGET = 113.0
v_cap = optimize_payload(track, corridor_cm=50.0, uebergang="bestand",
                         maxiter=40, seed=1, v_max=V_TARGET)
off_free = max(r["offsetCm"] for r in v_free["report"] if r["changed"])
off_cap = max(r["offsetCm"] for r in v_cap["report"] if r["changed"])
print(f"   Ziel {V_TARGET:.0f}: ohne Deckel {v_free['vNeu']:.1f} km/h bei {off_free:.1f} cm, "
      f"mit Deckel {v_cap['vNeu']:.1f} km/h bei {off_cap:.1f} cm")
ok("Ziel wird erreicht", v_cap["vNeu"] >= V_TARGET - 1e-6)
ok("und nicht nennenswert überschritten", v_cap["vNeu"] < V_TARGET + 2.0)
ok("der Deckel rückt das Gleis weniger ab", off_cap < off_free - 1.0)
ok("Grund: am Ziel steht die Zielgeschwindigkeit (AP R.4)", all(
   r["grund"]["regel"] == "zielgeschwindigkeit" for r in v_cap["report"] if r["changed"]))

# Ein Bogen, der den Bestand schon schneller macht als das Ziel, wird in Ruhe
# gelassen — ein Lauf verbessert eine Trasse, er flacht keine ab.
v_below = optimize_payload(track, corridor_cm=50.0, uebergang="bestand",
                           maxiter=40, seed=1, v_max=100.0)
ok("Ziel unter dem Bestand ändert nichts an den Radien",
   all(abs(r["rNeu"] - r["rAlt"]) < 1e-9 for r in v_below["report"] if r["changed"]))
ok("Ziel unter dem Bestand ändert nichts an den Überhöhungen",
   all(abs(r["uNeu"] - r["uAlt"]) < 1e-9 for r in v_below["report"] if r["changed"]))
ok("Ziel unter dem Bestand: v bleibt der Bestandswert",
   abs(v_below["vNeu"] - v_below["vBestand"]) < 1e-6)
ok("ohne Ziel bleibt alles wie bisher", v_free["vNeu"] >= v_cap["vNeu"] - 1e-9)

cap_params = run_params(50.0, v_max=V_TARGET)
ok("capped deckelt nur nach oben",
   capped(200.0, cap_params) == V_TARGET and capped(80.0, cap_params) == 80.0
   and capped(200.0, params) == 200.0)
ok("capped: über der schnellsten Entwurfsgeschwindigkeit des Katalogs zählt nichts mehr",
   capped(340.0, params) == REG.v_top == 300.0)


# ── 10) Unlesbare Abschnitte werden übersprungen, nicht abgelehnt ────────────
# In die Zwischengerade der Dreibogen-Strecke wird ein Übergangsbogen ohne
# Krümmung eingesetzt — geometrisch dieselbe Linie, für den Parser aber eine
# Rampe, die in keinen Bogen läuft. Früher war damit der ganze Track hin.
GAP_AT = w_groups[0]["exit_idx"]
gap_straight = elements3[GAP_AT]
g_from, g_to = tuple(gap_straight["startNode"]), tuple(gap_straight["endNode"])
g_dir = dir_of(gap_straight["bearing"])
g_len = gap_straight["length"]
g_a = (g_from[0] + g_len / 3 * g_dir[0], g_from[1] + g_len / 3 * g_dir[1])
gap_els = (elements3[:GAP_AT]
           + [_straight_element(g_from, g_a, EPSG, 100),
              _transition_element(g_a, gap_straight["bearing"], g_len / 3,
                                  None, None, "clothoid", EPSG, 100)]
           + [_straight_element((g_from[0] + 2 * g_len / 3 * g_dir[0],
                                 g_from[1] + 2 * g_len / 3 * g_dir[1]), g_to, EPSG, 100)]
           + elements3[GAP_AT + 1:])
gap_track = {**track3, "id": "py-luecke", "elements": gap_els}
check_chain(gap_els, "Track mit unlesbarer Stelle")

gaps = []
gap_groups = parse_groups(gap_track, skipped=gaps)
ok("Track mit unlesbarer Stelle wird angenommen", len(gap_groups) == 3)
ok("die Stelle wird gemeldet, mit Grund",
   len(gaps) == 1 and gaps[0][0] == gaps[0][1] == GAP_AT + 1
   and "Bogen" in gaps[0][2])
print(f"   übersprungen: Element {gaps[0][0]} — {gaps[0][2]}")
ok("die Geraden um die Lücke dürfen nicht wandern",
   GAP_AT not in _interior_straights(gap_groups)
   and GAP_AT + 2 not in _interior_straights(gap_groups))

gap_res = optimize_payload(gap_track, corridor_cm=50.0, uebergang="bestand",
                           maxiter=25, seed=1)
ok("das Ergebnis nennt die übersprungene Stelle",
   len(gap_res["skipped"]) == 1 and gap_res["skipped"][0]["from"] == GAP_AT + 1)
ok("kein Element geht verloren", len(gap_res["elements"]) == len(gap_els))
check_chain(gap_res["elements"], "Track mit Lücke, optimiert")
ok("die unlesbare Stelle bleibt, wie sie liegt",
   close_pt(gap_res["elements"][GAP_AT + 1]["startNode"], gap_els[GAP_AT + 1]["startNode"])
   and close_pt(gap_res["elements"][GAP_AT + 1]["endNode"], gap_els[GAP_AT + 1]["endNode"]))
ok("die Bögen drumherum werden trotzdem schneller",
   gap_res["vNeu"] > gap_res["vBestand"] + 1)

# Erst wenn gar nichts lesbar ist, wird abgelehnt — und dann mit dem Grund.
_G = {"elementType": 0, "startNode": [0, 0], "endNode": [1, 1], "length": 1.0}
_U = {"elementType": 2, "startNode": [1, 1], "endNode": [2, 2], "length": 1.0}


def _arc_of(radius):
    return {"elementType": 1, "radius": radius, "startNode": [1, 1],
            "endNode": [2, 2], "length": 1.0}


for label, plain in (
        ("nur eine Rampe zwischen Geraden", [_G, _U, _G]),
        ("drei gegensinnige Bögen ohne Zwischengerade",
         [_G, _arc_of(700.0), _arc_of(-700.0), _arc_of(700.0), _G])):
    try:
        parse_groups({**track3, "elements": plain})
        ok(f"{label} → abgelehnt", False)
    except SystemExit as exc:
        ok(f"{label} → abgelehnt und begründet",
           "Keine optimierbaren Bögen" in str(exc) and len(str(exc).split(".")) > 2)


# ── 11) Die Überhöhung darf auch fallen ─────────────────────────────────────
# Weniger Überhöhung heißt kürzere Rampen, und die Länge, die das freimacht,
# kauft Radius. Innerhalb des 50-cm-Korridors, den das Panel anbietet, kommt
# dieser Handel nie zum Tragen — dort ist der Korridor die bindende Schranke und
# der Radius kann ohnehin kaum wachsen. Im weiten Korridor der CLI gewinnt er.
UB1, UB2 = 40.0, 46.0                       # 6° Richtungswechsel, kurze Schenkel
UD1, UD2 = dir_of(UB1), dir_of(UB2)
UP1 = (500000.0, 5600000.0)
UV = (UP1[0] + 300 * UD1[0], UP1[1] + 300 * UD1[1])
UP2 = (UV[0] + 300 * UD2[0], UV[1] + 300 * UD2[1])
u_fit = fit_compound_group(UP1, UD1, UB1, UP2, UD2, UB2, [2500.0], [], [60.0, 60.0],
                           ["clothoid", "clothoid"])
ok("Rampenhandel: Seed-Fit existiert", u_fit is not None)
u_els = build_from_fit(u_fit, [110.0], UP1, UP2)
u_track = {"id": "py-ueberhoehung", "name": "u.001", "epsg": EPSG, "elements": u_els}
check_chain(u_els, "Rampenhandel-Seed")
u_groups = parse_groups(u_track)
u_alt = u_groups[0]["arcs"][0]["u_alt"]


def _best_at(group, prms, only_upwards):
    """Die Baseline-Auswahl, wahlweise mit dem alten Raster (nur nach oben)."""
    alt = group["arcs"][0]["u_alt"]
    v_alt = bestand_speed(group, prms)
    grid = [alt]
    u = alt if only_upwards else 0.0
    while u <= u_max_for(group, prms):
        if u != alt and (not only_upwards or u > alt):
            grid.append(u)
        u += 5.0
    best = None
    for value in grid:
        cand = _max_radius_for(group, value, prms)
        if cand and cand["v"] >= v_alt - 1e-9 and (best is None or cand["v"] > best["v"]):
            best = cand
    return best


# Am Regelwert gibt es nach oben gar keinen Weg mehr: 110 mm auf R 2500 hieße
# bei rund 225 km/h eine Rampe von 10·v·Δu ≈ 250 m, auf 300 m langen Schenkeln.
ok("am Regelwert führt nur der Weg nach unten",
   _best_at(u_groups[0], run_params(200.0), True) is None
   and _best_at(u_groups[0], run_params(200.0), False) is not None)
# Den Handel selbst zeigt die Ermessensgrenze, wo beide Richtungen gehen.
wide = run_params(200.0, "discretion")
u_up = _best_at(u_groups[0], wide, True)
u_free = _best_at(u_groups[0], wide, False)
print(f"   Rampenhandel (2 m Korridor): nur hoch u {u_up['us'][0]:.0f} R {u_up['radii'][0]:.0f} "
      f"v {u_up['v']:.2f} → frei u {u_free['us'][0]:.0f} R {u_free['radii'][0]:.0f} v {u_free['v']:.2f} km/h")
ok("im weiten Korridor gewinnt die kleinere Überhöhung",
   u_free["us"][0] < u_alt and u_free["v"] > u_up["v"] + 0.5)
ok("sie kauft dafür Radius", u_free["radii"][0] > u_up["radii"][0])
check_rules("Rampenhandel", u_els, build_elements(u_track, u_groups, [u_free], {}), ERM)
_ramp_reason = binding_reason(u_groups[0], u_free, wide)
ok(f"Grund: im weiten Korridor bindet die Rampe, und der Grund nennt ihre Regel ({_ramp_reason})",
   _ramp_reason["regel"] == "rampenregel" and _ramp_reason.get("regelId") == "LP.UB.03")
ok("die gesenkte Überhöhung liegt im 5-mm-Raster", on_grid(u_free["us"][0], 5.0))
ok("die Baseline nimmt diese Lösung auch",
   (baseline(u_groups, wide)[0] or {}).get("us", [None])[0] == u_free["us"][0])

narrow = baseline(u_groups, params)[0]
ok("im 50-cm-Korridor lohnt der Handel nicht und die Überhöhung bleibt",
   narrow is None or narrow["us"][0] >= u_alt)

# Kein Vorschlag darf langsamer sein als der Bestand. Wo dessen Rampen zu kurz
# für seine Überhöhung sind, kommt jede regelkonforme Antwort langsamer heraus —
# die Gruppe bleibt dann liegen, statt heruntergeredet zu werden.
SB1, SB2 = 40.0, 85.0
SD1, SD2 = dir_of(SB1), dir_of(SB2)
SV = (UP1[0] + 320 * SD1[0], UP1[1] + 320 * SD1[1])
SP2 = (SV[0] + 320 * SD2[0], SV[1] + 320 * SD2[1])
s_fit = fit_compound_group(UP1, SD1, SB1, SP2, SD2, SB2, [600.0], [], [90.0, 90.0],
                           ["clothoid", "clothoid"])
s_track = {"id": "py-kurzrampe", "name": "k.001", "epsg": EPSG,
           "elements": build_from_fit(s_fit, [140.0], UP1, SP2)}
s_groups = parse_groups(s_track)
s_params = params
s_alt = bestand_speed(s_groups[0], s_params)
s_base = baseline(s_groups, s_params)
s_offer = "keiner" if s_base[0] is None else f"{s_base[0]['v']:.1f} km/h"
print(f"   zu kurze Bestandsrampe: Bestand {s_alt:.1f} km/h (regelwidrig), Vorschlag {s_offer}")
ok("ein Bestand mit zu kurzer Rampe wird nicht heruntergeredet",
   s_base[0] is None or s_base[0]["v"] >= s_alt - 1e-9)

# Unter einer Zielgeschwindigkeit gewinnt bei Gleichstand die Überhöhung, die
# dem Bestand am nächsten liegt — weniger Umbau bei gleichem Ergebnis.
tie_target = permissible_speed(700.0, 90.0, 130.0)
tie = baseline(groups, run_params(50.0, v_max=tie_target))
ok("bei Gleichstand bleibt die Überhöhung möglichst, wie sie war", all(
   abs(s["us"][0] - g["arcs"][0]["u_alt"]) <= 25.0 for g, s in zip(groups, tie) if s))
ok("und das Ziel wird trotzdem erreicht",
   all(s is None or s["v"] >= tie_target - 1e-6 for s in tie))


# ── 12) S-Bögen ohne Zwischengerade ─────────────────────────────────────────
# Zwei gegensinnige Bögen zwischen zwei Geraden — die Gleisverziehung, mit der
# ein Gleis seitlich versetzt wird. Der Gleichsinn-Löser kann das nicht: er
# schließt die Richtung über den letzten Bogen und schiebt die Form dann auf der
# Eingangsgeraden, bis sie die Ausgangsgerade trifft. Zwischen nahezu parallelen
# Geraden ändert dieses Schieben den Abstand aber kaum — also löst `fit_s_group`
# stattdessen die Form selbst.
SB = 40.0
SD = dir_of(SB)
SN = (-SD[1], SD[0])
SP1 = (500000.0, 5600000.0)
S_OFFSET = 15.0
SP2 = (SP1[0] + 1200 * SD[0] + S_OFFSET * SN[0], SP1[1] + 1200 * SD[1] + S_OFFSET * SN[1])
# Nicht enger: die Wendeklothoide trägt den Fehlbetrag beider Bögen (LP.UB.05,
# Δu_f ist die Summe), und ein S aus R 600 auf 6 m Versatz hat für eine solche
# Rampe keinen Platz — der Lauf ließe es zu Recht liegen.
s_fit2 = fit_s_group(SP1, SD, SB, SP2, SD, SB, [-1200.0, 1200.0], [70.0, 100.0, 70.0],
                     ["clothoid"] * 3, 300.0)
ok("S-Bogen: Fit existiert", s_fit2 is not None)
ok("S-Bogen: Ende liegt auf der Ausgangsgeraden",
   abs((s_fit2["cl_end"][0] - SP2[0]) * SN[0]
       + (s_fit2["cl_end"][1] - SP2[1]) * SN[1]) < 1e-6)
s_els2 = build_from_fit(s_fit2, [40.0, 40.0], SP1, SP2)
s_track2 = {"id": "py-sbogen", "name": "s.001", "epsg": EPSG, "elements": s_els2}
check_chain(s_els2, "S-Bogen-Seed")
ok("S-Bogen-Seed: die Bögen drehen gegensinnig",
   len({el["radius"] > 0 for el in s_els2 if el["elementType"] == 1}) == 2)

s_groups2 = parse_groups(s_track2)
ok("S-Bogen: eine Gruppe, als S erkannt",
   len(s_groups2) == 1 and s_groups2[0]["s_curve"]
   and len(s_groups2[0]["arcs"]) == 2 and s_groups2[0]["signs"] == [-1.0, 1.0])
s_best2 = _bestand_solution(s_groups2[0], params)
ok("S-Bogen: der Bestand ist reproduzierbar", s_best2 is not None)
ok(f"S-Bogen: die Bestandslage trifft das Gleis "
   f"({(s_best2 or {}).get('offset', 9) * 100:.3f} cm)",
   s_best2 is not None and s_best2["offset"] < 1e-3)

# Über die Mittelrampe springt die Überhöhung von einer Seite auf die andere.
# Mit u_f = 0 (u_0 = u), damit allein der Überhöhungssprung zählt: R so, dass
# 11,8·120²/R genau 70 mm ergibt.
S_R = CANT_DEFICIENCY_COEFF * 120.0 ** 2 / 70.0
s_lens, s_rules = ramp_lengths(s_groups2[0], 120.0, [S_R, S_R], [70.0, 70.0], params)
ok("S-Bogen: die Mittelrampe rechnet mit der Summe der Überhöhungen (LP.UB.03, 10·v·Δu)",
   abs(s_lens[1] - snap_up(10 * 120.0 * 140.0 / 1000.0, L_STEP)) < 1e-9 and s_rules[1] == "LP.UB.03")
ok("S-Bogen: die Außenrampen rechnen mit der einzelnen Überhöhung",
   abs(s_lens[0] - snap_up(10 * 120.0 * 70.0 / 1000.0, L_STEP)) < 1e-9)

s_res2 = optimize_payload(s_track2, corridor_cm=50.0, uebergang="bestand",
                          maxiter=25, seed=1)
ok("S-Bogen: der Lauf nimmt ihn an, statt ihn zu überspringen", not s_res2["skipped"])
print(f"   S-Bogen: Bestand {s_res2['vBestand']:.1f} → {s_res2['vNeu']:.1f} km/h, "
      f"R {s_res2['report'][0]['rAlt']:.0f}/{s_res2['report'][1]['rAlt']:.0f} → "
      f"{s_res2['report'][0].get('rNeu', 0):.0f}/{s_res2['report'][1].get('rNeu', 0):.0f} m")
ok("S-Bogen: nie schlechter als der Bestand", s_res2["vNeu"] >= s_res2["vBestand"] - 1e-6)
ok("S-Bogen: er wird auch wirklich schneller", s_res2["vNeu"] > s_res2["vBestand"] + 5)
ok("S-Bogen: die Bögen werden dabei weiter", all(
   r["rNeu"] > r["rAlt"] + 1 for r in s_res2["report"] if r["changed"]))
ok("S-Bogen: der Korridor wird eingehalten",
   all(r["offsetCm"] <= 50.0 + 1e-6 for r in s_res2["report"] if r["changed"]))
ok("Grund: im engen Korridor bindet der Korridor, nicht die Rampenregel",
   all(r["grund"]["regel"] == "korridor" for r in s_res2["report"] if r["changed"]))
check_chain(s_res2["elements"], "S-Bogen optimiert")
ok("S-Bogen: Endpunkte fix",
   close_pt(s_res2["elements"][0]["startNode"], SP1)
   and close_pt(s_res2["elements"][-1]["endNode"], SP2))
ok("S-Bogen: die Bögen drehen weiter gegensinnig",
   len({el["radius"] > 0 for el in s_res2["elements"] if el["elementType"] == 1}) == 2)
ok("S-Bogen: Radien in ganzen Metern", all(
   on_grid(abs(el["radius"]), R_STEP) for el in s_res2["elements"] if el["elementType"] == 1))
check_rules("S-Bogen", s_els2, s_res2["elements"])
s_measured = independent_offset(s_els2, s_res2["elements"])
ok(f"S-Bogen: unabhängige Abrückung ≤ 51 cm ({s_measured * 100:.1f} cm)", s_measured <= 0.51)


# ── 13) Physik: Driftprüfung (AP R.1) ───────────────────────────────────────
# physics.json ist die lesbare Herleitung; der Kernel rechnet mit seinem
# eigenen Koeffizienten weiter (siehe den Docstring von geometry.py). Dieser
# Abschnitt hält beide gegeneinander ehrlich.

physics = json.loads((REPO_ROOT / "src" / "constraints" / "physics.json")
                     .read_text(encoding="utf-8"))
ok("Physik: Überhöhungsfehlbetrag-Koeffizient stimmt mit dem Kernel überein",
   physics["ueberhoehungsfehlbetrag_koeffizient"]["wert"] == CANT_DEFICIENCY_COEFF)
s_gauge = physics["wirksame_spurweite"]["wert"]
g_erde = physics["erdbeschleunigung"]["wert"]
derived = 1000.0 * s_gauge / (g_erde * 3.6 ** 2)
ok(f"Physik: die Herleitung aus s und g rundet auf denselben Koeffizienten ({derived:.4f} → 11,8)",
   round(derived, 1) == round(CANT_DEFICIENCY_COEFF, 1))
ok("Physik: die Formel aus der Datei trifft permissible_speed (1e-12)",
   abs(math.sqrt(700.0 * (120.0 + 130.0) / physics["ueberhoehungsfehlbetrag_koeffizient"]["wert"])
       - permissible_speed(700.0, 120.0, 130.0)) < 1e-12)


def _eval_formel(expr, **variablen):
    """`expr` is one of physics.json's `*_calc` fields — a bare arithmetic
    expression, never anything a user typed or a service answered, so eval()
    is safe here the same way it would not be on external input. No builtins,
    no name but the ones the formula names and `sqrt` for the one place that
    needs it — an expression reaching for anything else is a bug in the file,
    and this makes it fail loudly instead of silently succeeding at the wrong
    thing."""
    return eval(expr, {"__builtins__": {}, "sqrt": math.sqrt}, variablen)          # noqa: S307


koeff = physics["ueberhoehungsfehlbetrag_koeffizient"]
ok("Physik: formel_calc, ausgewertet, trifft ebenfalls permissible_speed (1e-12)",
   abs(_eval_formel(koeff["formel_calc"], R=700.0, u=120.0, uf=130.0, k=koeff["wert"])
       - permissible_speed(700.0, 120.0, 130.0)) < 1e-12)

ok("Physik: beide Übergangsbogenprofile sind beschrieben",
   {"clothoid", "bloss"} <= set(physics["uebergangsbogenprofile"]))

# kruemmung_calc, ausgewertet gegen den Kernel: geometry.py hält keine
# kappa(s)-Funktion vor, sondern die Koeffizienten von deren Stammfunktion,
# dem Heading-Polynom h(s) (heading_coeffs) — kappa(s) ist dessen Ableitung,
# a1 + 2 a2 s + 3 a3 s^2 + 4 a4 s^3. Das ist derselbe Weg, auf dem
# physics.json selbst zu seinen beiden Formeln kommt (siehe deren `warum`).
def _kernel_kappa(profile, k1, k2, length, s):
    a1, a2, a3, a4 = heading_coeffs(profile, k1, k2, length)
    return a1 + s * (2 * a2 + s * (3 * a3 + s * 4 * a4))


for _name, _profil in physics["uebergangsbogenprofile"].items():
    if "kruemmung_calc" not in _profil:
        continue
    _k1, _k2, _L, _s = -0.01, 0.02, 120.0, 45.0
    _from_file = _eval_formel(_profil["kruemmung_calc"], kappa1=_k1, kappa2=_k2, L=_L, s=_s)
    _from_kernel = _kernel_kappa(_name, _k1, _k2, _L, _s)
    ok(f"Physik: kruemmung_calc von '{_name}' trifft den Kernel (1e-12)",
       abs(_from_file - _from_kernel) < 1e-12)

# ── 14) Der Regelkatalog, den ein Lauf anwendet ─────────────────────────────
# Kein Wert mehr im Code und keine Kopie im Paket: ein Lauf liest
# src/constraints/db-ril-800-0110.json, dieselbe Datei, die die App bündelt.
ok("Katalog: olt_optimizer/constraints ist das src/constraints/ des Repos, keine Kopie",
   CONSTRAINTS_DIR.resolve() == (REPO_ROOT / "src" / "constraints").resolve())
rw_list = list_regelwerke()
katalog_file = json.loads((REPO_ROOT / "src" / "constraints" / "db-ril-800-0110.json")
                          .read_text(encoding="utf-8"))
ok("Katalog: gelistet wird genau DB Ril 800.0110, mit der Version der Datei",
   [r["id"] for r in rw_list] == ["db-ril-800-0110"]
   and rw_list[0]["version"] == katalog_file["catalog"]["katalog_version"])
ok("Katalog: load_regelwerk() ist die Datei, unverändert", load_regelwerk() == katalog_file)
for bad_id in ("nicht-vorhanden", "db-ril-800-0120", "physics", "../constraints/physics"):
    try:
        load_regelwerk(bad_id)
        ok(f"Katalog: '{bad_id}' wird abgelehnt", False)
    except RegelwerkError:
        ok(f"Katalog: '{bad_id}' wird abgelehnt", True)

# Die Ausdruckssprache — dieselben Fälle, an denen ruleExpr.js hängt.
ok("Ausdruck: Punkt vor Strich, ^ bindet rechts",
   eval_expr("2 + 3 * 4", {}) == 14 and eval_expr("2 ^ 3 ^ 2", {}) == 512
   and eval_expr("-2 ^ 2", {}) == -4)
ok("Ausdruck: Namen mit Punkt sind ein Name",
   eval_expr("prev.design_speed * 2", {"prev.design_speed": 40}) == 80)
ok("Ausdruck: and/or/not und Vergleiche",
   eval_expr("v >= 40 and v <= 300", {"v": 40}) is True
   and eval_expr("not (v % 5 == 0)", {"v": 42}) is True)
ok("Ausdruck: % wie in JavaScript (Vorzeichen des Dividenden)",
   eval_expr("-7 % 5", {}) == -2)
ok("Ausdruck: if rechnet nur den gewählten Zweig",
   eval_expr("if(r > 0, 1000 / r, 0)", {"r": 0}) == 0)
ok("Ausdruck: Zeichenketten",
   eval_expr("form == 'clothoid'", {"form": "clothoid"}) is True)
for bad_src, bad_scope in (("unbekannt + 1", {}), ("1 +", {}), ("3 & 4", {}), ("'offen", {}),
                           ("wurzel(4)", {})):
    try:
        eval_expr(bad_src, bad_scope)
        ok(f"Ausdruck: '{bad_src}' wird nicht stillschweigend beantwortet", False)
    except ExprError:
        ok(f"Ausdruck: '{bad_src}' wird nicht stillschweigend beantwortet", True)
ok("Ausdruck: comparison liest 'Eingang ≥ Schwelle'",
   comparison("l_R >= reg") == ("l_R", ">=", "reg") and comparison("u >= 0 and u % step == 0") is None)

# Der Katalog selbst, ausgewertet wie in regelkatalog.js.
KAT = load_katalog()
ok("Katalog: LP.KB.02 wird bei 160 km/h zur Warnung, ab 151 mm zum Fehler",
   KAT.evaluate_rule(KAT.rule("LP.KB.02"), {"element.design_speed": 160.0, "physics.u_f": 140.0})["severity"]
   == "warning"
   and KAT.evaluate_rule(KAT.rule("LP.KB.02"), {"element.design_speed": 160.0, "physics.u_f": 151.0})["severity"]
   == "error"
   and KAT.evaluate_rule(KAT.rule("LP.KB.02"), {"element.design_speed": 150.0, "physics.u_f": 140.0})["severity"]
   == "error")
ok("Katalog: Mindestelementlänge aus der Stufentabelle (0,1·v / 0,15·v / 0,2·v)",
   [REG.min_length("straight", V) for V in (40.0, 70.0, 75.0, 100.0, 105.0, 300.0)]
   == [4.0, 7.0, 11.25, 15.0, 21.0, 60.0])
ok("Katalog: Zwischengerade zwischen Gegenbögen bei genau 40 km/h 7,2 m (LP.EL.02)",
   REG.min_length("straight", 40.0, True) == 7.2 and REG.min_length("straight", 45.0, True) == 4.5)
_rw_reg = [REG.jump_need(V) for V in (40.0, 45.0, 100.0, 200.0, 205.0)]
_rw_erm = [ERM.jump_need(V) for V in (40.0, 45.0, 100.0, 200.0)]
ok(f"Katalog: Vergleichsradius — Tabellenwert, dazwischen nächsthöher bzw. Formel ({_rw_reg}, {_rw_erm})",
   _rw_reg[:4] == [220, 340, 1370, 10000] and _rw_reg[4] == math.inf
   and _rw_erm[0] == 178 and abs(_rw_erm[1] - CANT_DEFICIENCY_COEFF * 45 ** 2 / 106.5) < 1e-9
   and _rw_erm[2:] == [1110, 7000])

# Die beiden Stufen, gegeneinander.
ok("Stufen: Entwurfsgeschwindigkeiten 40…300 in 5 km/h, auf beiden gleich",
   REG.speeds == ERM.speeds and REG.speeds[0] == 40.0 and REG.speeds[-1] == 300.0
   and all(b - a == 5.0 for a, b in zip(REG.speeds, REG.speeds[1:])))
ok("Stufen: Überhöhung 0…160 mm in 5 mm (LP.KB.01/03)",
   REG.u_max() == ERM.u_max() == 160.0 and REG.u_step == ERM.u_step == 5.0)
ok("Stufen: u_f 130 mm am Regelwert, an der Ermessensgrenze 150 erst über 150 km/h (LP.KB.02)",
   {REG.uf_max(V) for V in REG.speeds} == {130.0}
   and ERM.uf_max(150.0) == 130.0 and ERM.uf_max(155.0) == 150.0)
ok("Stufen: R 2000 ohne Überhöhung — 148 km/h am Regelwert, 159 an der Ermessensgrenze",
   abs(REG.speed(2000.0, 0.0) - permissible_speed(2000.0, 0.0, 130.0)) < 1e-9
   and abs(ERM.speed(2000.0, 0.0) - permissible_speed(2000.0, 0.0, 150.0)) < 1e-9
   and round(REG.speed(2000.0, 0.0)) == 148 and round(ERM.speed(2000.0, 0.0)) == 159)
ok("Stufen: eine Kurve knapp über 150 km/h rechnet mit 130 mm — ihre Entwurfsgeschwindigkeit ist 150",
   ERM.speed(1740.0, 0.0) == permissible_speed(1740.0, 0.0, 130.0))
_ramp_reg = REG.ramp_bounds("clothoid", 100.0, 100.0, 0.0)
_ramp_erm = ERM.ramp_bounds("clothoid", 100.0, 100.0, 0.0)
ok(f"Stufen: Klothoidenrampe 10·v·Δu am Regelwert, 8·v·Δu an der Ermessensgrenze ({_ramp_reg[:2]}, {_ramp_erm[:2]})",
   _ramp_reg[0] == 100.0 and _ramp_reg[2] == "LP.UB.03" and _ramp_erm[0] == 80.0)
_duf = REG.ramp_bounds("clothoid", 100.0, 0.0, 130.0)
ok(f"Stufen: ohne Überhöhungssprung trägt die Rampe den Fehlbetragssprung (LP.UB.05, {_duf[:3]})",
   _duf[0] == 4 * 100.0 * 130.0 / 1000.0 and _duf[2] == "LP.UB.05")
_slow = REG.ramp_bounds("clothoid", 40.0, 100.0, 0.0)
ok(f"Stufen: bei 40 km/h bindet die Neigung 1:600 statt 10·v (LP.UB.07, {_slow[:3]})",
   _slow[0] == 60.0 and _slow[2] == "LP.UB.07" and ERM.ramp_bounds("clothoid", 40.0, 100.0, 0.0)[0] == 40.0)
_flat = REG.ramp_bounds("clothoid", 150.0, 5.0, 0.0)
ok(f"Stufen: eine Rampe darf nicht flacher als 1:3000 sein (LP.UB.08, {_flat[:2]})",
   _flat[1] == 15.0 and _flat[0] == 30.0)
ok("Stufen: jump_speed setzt die Gruppe auf die schnellste Entwurfsgeschwindigkeit, bei der der Sprung passt",
   REG.jump_speed(900.0, 120.0) == 80.0 and ERM.jump_speed(900.0, 120.0) == 90.0
   and REG.jump_speed(5000.0, 120.0) == 120.0 and REG.jump_speed(100.0, 120.0) is None
   and REG.jump_speed(100.0, 120.0, internal=True) == 120.0)
try:
    grenzen_for("db-ril-800-0110", "approval")
    ok("Stufen: nur Regelwert und Ermessensgrenze", False)
except GrenzenError:
    ok("Stufen: nur Regelwert und Ermessensgrenze", True)

# Was der Optimierer nicht umsetzen kann, lehnt er ab, statt es zu übergehen.
_extra = json.loads(json.dumps(katalog_file))
_extra["rules"].append({
    "id": "LP.TEST.01", "title": "Mindestradius", "status": "confirmed",
    "applies_to": {"scope": "element", "element_types": ["circular_arc"]},
    "inputs": {"r": {"from": "element.radius", "unit": "m"}},
    "thresholds": {"min": {"expr": "300", "unit": "m"}},
    "evaluation": [{"if": "r >= min", "severity": "ok"}, {"else": "error"}]})
try:
    Grenzen(Katalog(_extra, physics={"u0_factor": CANT_DEFICIENCY_COEFF}), "reg")
    ok("Katalog: eine Regel, die der Optimierer nicht kennt, wird abgelehnt", False)
except GrenzenError as exc:
    ok(f"Katalog: eine Regel, die der Optimierer nicht kennt, wird abgelehnt ({exc})",
       "LP.TEST.01" in str(exc))
_hint = json.loads(json.dumps(_extra))
_hint["rules"][-1]["evaluation"][1] = {"else": "hint"}
ok("Katalog: dieselbe Regel als bloßer Hinweis bindet keinen Lauf",
   isinstance(Grenzen(Katalog(_hint, physics={"u0_factor": CANT_DEFICIENCY_COEFF}), "reg"), Grenzen))

# Ein Lauf, einmal je Stufe — und das Ergebnis besteht die Prüfung der App.
reg_res = optimize_payload(track3, corridor_cm=50.0, uebergang="bestand", maxiter=25, seed=1)
erm_res = optimize_payload(track3, corridor_cm=50.0, grenzwert="discretion", uebergang="bestand",
                           maxiter=25, seed=1)
print(f"   Regelwert {reg_res['vBestand']:.1f} → {reg_res['vNeu']:.1f} km/h | "
      f"Ermessensgrenze {erm_res['vBestand']:.1f} → {erm_res['vNeu']:.1f} km/h")
ok("Lauf: das Ergebnis nennt Regelwerk, Katalogversion und Stufe",
   reg_res["regelwerk"] == "db-ril-800-0110" and reg_res["grenzwert"] == "reg"
   and erm_res["grenzwert"] == "discretion"
   and reg_res["regelwerkVersion"] == katalog_file["catalog"]["katalog_version"])
ok("Lauf: die Ermessensgrenze ist nie langsamer als der Regelwert", erm_res["vNeu"] >= reg_res["vNeu"] - 1e-6)
check_rules("Lauf am Regelwert", elements3, reg_res["elements"], REG)
_erm_findings = check_rules("Lauf an der Ermessensgrenze", elements3, erm_res["elements"], ERM)
ok("Lauf: die Ermessensgrenze schöpft den Spielraum auch aus (Warnungen, die der Regelwert nicht hätte)",
   any(sev == "warning" for _, _, sev in _erm_findings))
# An der Ermessensgrenze mit Bloss-Variante: sie wird gerechnet, und wo sie
# gewinnt, besteht sie die Prüfung — mit LP.UB.02 als Sonderfall und sonst nichts.
bl_res = optimize_payload(track3, corridor_cm=50.0, grenzwert="discretion", uebergang="bloss",
                          maxiter=25, seed=1)
auto_res = optimize_payload(track3, corridor_cm=50.0, grenzwert="discretion", uebergang="auto",
                            maxiter=25, seed=1)
print(f"   Ermessensgrenze: Bestand-Typen {erm_res['vNeu']:.1f} | Bloss {bl_res['vNeu']:.1f} | "
      f"auto {auto_res['vNeu']:.1f} km/h ({auto_res['variant']})")
ok("Bloss an der Ermessensgrenze: die Rampen sind Blossbögen",
   bl_res["variant"] == "Bloss"
   and all(el.get("transitionType") == "bloss"
           for el in (bl_res["elements"][i] for i in new_indices(elements3, bl_res["elements"]))
           if el["elementType"] == 2))
_bl_findings = check_rules("Bloss an der Ermessensgrenze", elements3, bl_res["elements"], ERM)
ok("Bloss an der Ermessensgrenze: als Sonderfall gemeldet wird nur LP.UB.02",
   {rid for _, rid, sev in _bl_findings if sev == "special_case"} == {"LP.UB.02"})
ok("auto an der Ermessensgrenze nimmt die schnellere Variante",
   abs(auto_res["vNeu"] - max(erm_res["vNeu"], bl_res["vNeu"])) < 1e-9)
for bad in ({"grenzwert": "approval"}, {"regelwerk": "nicht-vorhanden"}):
    try:
        optimize_payload(track3, **bad)
        ok(f"Lauf: {bad} wird abgelehnt", False)
    except ValueError:
        ok(f"Lauf: {bad} wird abgelehnt", True)

# Ein Bogen ohne Übergangsbogen: der Krümmungssprung an Gerade und Bogen hält
# die Gruppe auf der Geschwindigkeit, bei der sein Vergleichsradius reicht.
j_fit = fit_compound_group(P1, D1, B1, V2, D2, B2, [700.0], [], [0.0, 0.0], ["clothoid", "clothoid"])
# Die Geraden stehen auf 60 km/h: bei 100, wie der Rest der Testgleise, hätte
# schon die Gerade selbst mehr Vergleichsradius verlangt (1370 m), als der
# Sprung je bekommen kann — der Lauf ließe den Bogen dann liegen.
j_els = [{**el, "speed": 60} if el["elementType"] == 0 else el for el in
         build_from_fit(j_fit, [0.0], P1, (j_fit["cl_end"][0] + 400 * D2[0], j_fit["cl_end"][1] + 400 * D2[1]))]
j_track = {"id": "py-sprung", "name": "sprung.001", "epsg": EPSG, "elements": j_els}
j_groups = parse_groups(j_track)
ok("Krümmungssprung: Bogen ohne ÜB wird als Gruppe ohne Rampen gelesen",
   len(j_groups) == 1 and j_groups[0]["has_t"] == [False, False])
ok("Krümmungssprung: R 700 an der Geraden — 70 km/h am Regelwert (670 ≤ 700 < 875)",
   bestand_speed(j_groups[0], params) == 70.0
   and bestand_speed(j_groups[0], run_params(50.0, "discretion")) == 75.0)
j_res = optimize_payload(j_track, corridor_cm=500.0, uebergang="bestand", maxiter=25, seed=1)
j_row = j_res["report"][0]
print(f"   Krümmungssprung: v {j_res['vBestand']:.1f} → {j_res['vNeu']:.1f} km/h, "
      f"R {j_row['rAlt']:.0f} → {j_row.get('rNeu', j_row['rAlt']):.0f} m, Grund {j_row.get('grund')}")
ok("Krümmungssprung: ein Lauf macht den Bogen weiter, um schneller zu werden",
   j_row["changed"] and j_row["rNeu"] > j_row["rAlt"] and j_res["vNeu"] > j_res["vBestand"])
ok("Krümmungssprung: der Grund nennt LP.KS.01",
   (j_row.get("grund") or {}).get("regelId") == "LP.KS.01")
check_rules("Krümmungssprung", j_els, j_res["elements"])
j_fast = {**j_track, "elements": [{**el, "speed": 100} for el in j_els]}
j_fast_res = optimize_payload(j_fast, corridor_cm=500.0, uebergang="bestand", maxiter=25, seed=1)
ok("Krümmungssprung: steht die Gerade auf 100 km/h, bleibt der Bogen liegen (1370 m > jedes R im Korridor)",
   not any(r["changed"] for r in j_fast_res["report"]))


print()
sys.exit(1 if FAILED else 0)
