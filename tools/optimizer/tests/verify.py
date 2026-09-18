"""Verification harness (run: python tests/verify.py from tools/optimizer).

1. Geometry kernel against the reference values it was built to reproduce
   (generated with the app's JS kernel before AP 7.1 removed the JS optimizer).
2. n = 1 equivalence of the compound solver with the exact simple solver.
3. End-to-end: two-curve track and a compound curve (Korbbogen) → baseline →
   joint optimization; continuity, fixed end points, corridor, ramp rules,
   joint never below baseline.
4. Switch elements in a group: the tighter cant and deficiency limits (AP 1.1).
"""

import math
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from olt_optimizer.geometry import (          # noqa: E402
    transition_shift, fit_curve_group, fit_compound_group, dir_of,
    permissible_speed, max_dist_to_polyline, RAMP_FACTOR,
)
from olt_optimizer.track_io import (          # noqa: E402
    parse_groups, build_elements, _straight_element, _transition_element,
    _arc_element_seg, _element_ref_points,
)
from olt_optimizer.optimize import (        # noqa: E402
    baseline, joint_optimize, u_max_for, uf_for, window_for, _bestand_solution,
)
from olt_optimizer.api import optimize_payload                # noqa: E402

FAILED = 0


def ok(label, cond):
    global FAILED
    print(("PASS" if cond else "FAIL"), label)
    if not cond:
        FAILED += 1


close_pt = lambda a, b, tol=1e-6: math.hypot(a[0] - b[0], a[1] - b[1]) < tol   # noqa: E731


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

params = {"corridor": 0.5, "uf": 130.0}
base = baseline(groups, params)
v_alt = min(permissible_speed(a["r_alt"], a["u_alt"], params["uf"]) for g in groups for a in g["arcs"])
v_base = min(s["v"] for s in base)
print(f"   Bestand {v_alt:.1f} km/h → Baseline {v_base:.1f} km/h")
ok("Baseline verbessert Engpass-v", v_base > v_alt + 1)
ok("Baseline: Korridor eingehalten", all(s["offset"] <= 0.5 + 1e-6 for s in base))
ok("Baseline: Rampenregeln", all(
    s["trans_l"][0] >= RAMP_FACTOR[g["types"][0]] * s["v"] * s["us"][0] / 1000 - 1e-9
    for g, s in zip(groups, base)))

solutions, shifts, _ = joint_optimize(groups, len(elements), params, maxiter=40, seed=1)
v_joint = min(s["v"] for s in solutions)
print(f"   Joint {v_joint:.1f} km/h | Verschiebungen: "
      + (", ".join(f"#{k}: {v * 100:+.1f} cm" for k, v in shifts.items()) or "keine"))
ok("Joint ≥ Baseline", v_joint >= v_base - 1e-6)
ok("Joint: Korridor eingehalten", all(s["offset"] <= 0.5 + 1e-6 for s in solutions))
ok("Joint: u ≤ 160 im 5-mm-Raster", all(
    u <= 160 and (abs(u / 5 - round(u / 5)) < 1e-9 or u == a["u_alt"])
    for g, s in zip(groups, solutions) for a, u in zip(g["arcs"], s["us"])))

new_els = build_elements(track, groups, solutions, shifts)
check_chain(new_els, "Optimierter Track")
ok("Endpunkte fix", tuple(new_els[0]["startNode"]) == P1
   and math.hypot(new_els[-1]["endNode"][0] - P3[0], new_els[-1]["endNode"][1] - P3[1]) < 1e-9)
ok("Mindestlängen 0,2·v", all(el["length"] >= 0.2 * el.get("speed", 0) - 1e-6 for el in new_els))
measured = independent_offset(elements, new_els)
ok(f"unabhängige Abrückung ≤ 51 cm ({measured * 100:.1f} cm)", measured <= 0.51)

# ── 3b) Profilwechsel auf Bloss (kürzere Rampen, k=6) ────────────────────────
bloss_groups = [{**g, "types": ["bloss" if has else t for t, has in zip(g["types"], g["has_t"])]}
                for g in groups]
b_base = baseline(bloss_groups, params)
v_bloss = min(s["v"] for s in b_base)
print(f"   Baseline Bestand-Typen {v_base:.1f} km/h | alle Bloss {v_bloss:.1f} km/h")
ok("Bloss-Variante: Rampenregel mit k=6", all(
    s["trans_l"][0] >= RAMP_FACTOR["bloss"] * s["v"] * s["us"][0] / 1000 - 1e-9 for s in b_base))
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

k_sols, k_shifts, k_base = joint_optimize(k_groups, len(k_els), params, maxiter=60, seed=1)
k_sol = k_sols[0]
v_k_alt = min(permissible_speed(a["r_alt"], a["u_alt"], params["uf"]) for a in k_groups[0]["arcs"])
print(f"   Korbbogen: Bestand {v_k_alt:.1f} → Joint {k_sol['v']:.1f} km/h | "
      f"r {[round(a['r_alt']) for a in k_groups[0]['arcs']]} → {[round(r, 1) for r in k_sol['radii']]} | "
      f"u {[a['u_alt'] for a in k_groups[0]['arcs']]} → {k_sol['us']}")
ok("Korbbogen: v verbessert", k_sol["v"] > v_k_alt + 1)
ok("Korbbogen: u im 5-mm-Raster", all(
    u <= 160 and (abs(u / 5 - round(u / 5)) < 1e-9 or u == a["u_alt"])
    for a, u in zip(k_groups[0]["arcs"], k_sol["us"])))
ok("Korbbogen: Korridor eingehalten", k_sol["offset"] <= 0.5 + 1e-6)
ok("Korbbogen: Zwischenrampe nach Δu-Regel",
   k_sol["trans_l"][1] >= RAMP_FACTOR["clothoid"] * k_sol["v"] * abs(k_sol["us"][1] - k_sol["us"][0]) / 1000 - 1e-9)

k_new = build_elements(k_track, k_groups, k_sols, k_shifts)
check_chain(k_new, "Optimierter Korbbogen")
ok("Korbbogen: Endpunkte fix", tuple(k_new[0]["startNode"]) == P1
   and math.hypot(k_new[-1]["endNode"][0] - KP2[0], k_new[-1]["endNode"][1] - KP2[1]) < 1e-9)
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
n_sols, n_shifts, _ = joint_optimize(n_groups, len(n_els), params, maxiter=25, seed=1)
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
t_sols, t_shifts, _ = joint_optimize(t_groups, len(t_els), params, maxiter=25, seed=1)
ok("Dreibogen: Gruppe wird nicht gesperrt", t_sols[0] is not None)
v_t_alt = min(permissible_speed(a["r_alt"], a["u_alt"], params["uf"]) for a in t_groups[0]["arcs"])
ok("Dreibogen: nie schlechter als der Bestand", t_sols[0]["v"] >= v_t_alt - 1e-6)
t_new = build_elements(t_track, t_groups, t_sols, t_shifts)
check_chain(t_new, "Dreibogen optimiert")
ok("Dreibogen: alle drei Bögen gleiche Richtung",
   len({el["radius"] > 0 for el in t_new if el["elementType"] == 1}) == 1)
# Im weiteren Korridor bewegt sich die Gruppe auch wirklich — sonst sagte der
# Test oben nur, dass nichts passiert.
t_wide, _, _ = joint_optimize(parse_groups(t_track), len(t_els),
                              {"corridor": 5.0, "uf": 130.0}, maxiter=40, seed=1)
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
res = optimize_payload(track3, corridor_cm=50.0, uf=130.0, uebergang="bestand",
                       maxiter=40, seed=1, target_element_idx=TARGET_IDX)
rows = res["report"]
t_rows = [r for r in rows if r["target"]]
n_rows = [r for r in rows if not r["target"]]
ok("Report: nur Fenster-Gruppen, Ziel markiert",
   {r["group"] for r in rows} == {1, 2} and len(t_rows) == 1 and t_rows[0]["group"] == 1)
v0_alt = permissible_speed(w_groups[0]["arcs"][0]["r_alt"],
                           w_groups[0]["arcs"][0]["u_alt"], params["uf"])
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

ok("Weiche: u_max 100 mm statt 160, uf gedeckelt auf 110 mm",
   u_max_for(sw_groups[0]) == 100.0 and uf_for(sw_groups[0], params) == 110.0
   and u_max_for(sw_groups[1]) == 160.0 and uf_for(sw_groups[1], params) == params["uf"])

sw_base = baseline(sw_groups, params)
print(f"   Weichengruppe: u {sw_base[0]['us']} bei v {sw_base[0]['v']:.1f} km/h | "
      f"Streckengruppe: u {base[0]['us']} bei v {base[0]['v']:.1f} km/h")
ok("Weiche: Baseline überhöht höchstens 100 mm", all(u <= 100.0 for u in sw_base[0]["us"]))
ok("Weiche: gleiche Geometrie, aber weniger v als die Streckengruppe",
   sw_base[0]["v"] < base[0]["v"])

sw_sols, _, _ = joint_optimize(sw_groups, len(sw_elements), params, maxiter=40, seed=1)
ok("Weiche: auch die Joint-Optimierung bleibt unter 100 mm",
   all(u <= 100.0 for u in sw_sols[0]["us"]))

# Ein Bestandswert über der Grenze ist ein Befund für die Elementtabelle, keine
# Rechenreserve: er wird weder angehoben noch stillschweigend gekappt.
over_elements = [{**el, **({"switchBranch": True, "cant": 120.0} if i == SW_ARC else {})}
                 for i, el in enumerate(elements)]
over_groups = parse_groups({**track, "id": "py-weiche-ueber", "elements": over_elements})
over_base = baseline(over_groups, params)
ok("Weiche: Bestandsüberhöhung über der Grenze bleibt unverändert stehen",
   over_groups[0]["arcs"][0]["u_alt"] == 120.0
   and (over_base[0] is None or over_base[0]["us"] == [120.0]))

print()
sys.exit(1 if FAILED else 0)
