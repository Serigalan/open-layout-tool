"""Acceptance for the alignment fit from measured axis points (olt_optimizer/alignment_fit.py, AP 12.5).

Every case is a round trip: an ideal chain is built, sampled every 0.5 m like
the axis points of a trace, given a millimetre or two of scatter, and the fit
has to find the chain again — its straights, radii and transitions — and hand
back a chain that holds together.

    WEBSITE/.venv/bin/python tools/optimizer/tests/verify_align.py
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.alignment_fit import align, align_payload, chain_from, chain_points  # noqa: E402
from olt_optimizer.gradient_fit import fit_gradient, gradient_at                         # noqa: E402
from chain_check import chain_holds                                                       # noqa: E402

FAILED = []
E0, N0 = 4467000.0, 5333000.0


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


def axis_points(specs, bearing=60.0, step=0.5, noise=0.0015, seed=1):
    """Points every `step` along the chain of `specs`, scattered sideways."""
    poly, _ = chain_points(chain_from((E0, N0), bearing, specs))
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(poly, axis=0).T))])
    st = np.arange(0.0, along[-1], step)
    p = np.stack([np.interp(st, along, poly[:, 0]), np.interp(st, along, poly[:, 1])], axis=1)
    d = np.gradient(p, axis=0)
    d /= np.hypot(*d.T)[:, None]
    rng = np.random.default_rng(seed)
    return p + np.stack([d[:, 1], -d[:, 0]], axis=1) * rng.normal(0.0, noise, len(p))[:, None]


def near(a, b, tol):
    return abs(a - b) <= tol


# ── 1) A line with every kind of curve, starting and ending inside one ──────

SPECS = [("arc", 60, 1200.0), ("straight", 150, None),
         ("transition", 60, (None, 800.0)), ("arc", 120, 800.0), ("transition", 60, (800.0, None)),
         ("straight", 200, None), ("arc", 150, -2000.0), ("straight", 100, None),
         ("transition", 40, (None, -500.0)), ("arc", 80, -500.0), ("transition", 40, (-500.0, None)),
         ("straight", 80, None), ("transition", 50, (None, 600.0)), ("arc", 70, 600.0),
         ("transition", 30, (600.0, None))]
ans = align(axis_points(SPECS).tolist(), 100.0)
curves = ans["curves"]
ok("ganze Linie: kein Fehler, vier Geraden", ans.get("error") is None and len(ans["straights"]) == 4)
ok("ganze Linie: Stationen ab station0", ans["stations"][0] == 100.0)
ok("ganze Linie: fünf Bögen, Anfang und Ende offen",
   [c["kind"] for c in curves] == ["start", "curve", "curve", "curve", "end"])
c = curves[1]
ok("R 800 mit Übergangsbögen 60/60: R auf 0,5 m, L auf 1 m",
   near(c["radius"], 800, 0.5) and near(c["l1"], 60, 1) and near(c["l2"], 60, 1))
c = curves[2]
ok("R −2000 ohne Übergangsbogen: R auf 5 m, L = 0",
   near(c["radius"], -2000, 5) and c["l1"] == 0 and c["l2"] == 0)
c = curves[3]
ok("R −500 mit 40/40", near(c["radius"], -500, 0.5) and near(c["l1"], 40, 1) and near(c["l2"], 40, 1))
c = curves[0]
ok("Anfang in R 1200: R auf 2 m, kein Übergangsbogen", near(c["radius"], 1200, 2) and c["l1"] == 0 and c["l2"] == 0)
c = curves[4]
ok("Ende in R 600 mit Ein- und Auslauf: R auf 1 m, L₁ auf 2 m",
   near(c["radius"], 600, 1) and near(c["l1"], 50, 2) and c["l2"] > 20)
ok("kein Bogen als Korb- oder Gegenbogen gemeldet", all(not c["notes"] for c in curves))
why = chain_holds(ans["elements"], tol=1e-3)
ok(f"Kette hält zusammen ({why or 'ja'})", why is None)
ok("Abweichung: RMS ≤ 2 mm, max ≤ 7 mm bei 1,5 mm Streuung", ans["rms"] <= 0.002 and ans["max"] <= 0.007)
ok("je Element eine Abweichung, jede ≤ 7 mm",
   len(ans["elementStats"]) == len(ans["elements"]) and all(st["max"] <= 0.007 for st in ans["elementStats"] if st["n"]))
first, last = ans["elements"][0]["startNode"], ans["elements"][-1]["endNode"]
pts = axis_points(SPECS)
ok("Kette beginnt am ersten und endet am letzten Punkt (≤ 1 cm)",
   math.dist(first, pts[0]) < 0.01 and math.dist(last, pts[-1]) < 0.01)
ok("Elementanfänge in Stationen der Punkte", len(ans["elementStations"]) == len(ans["elements"]) + 1
   and near(ans["elementStations"][-1], ans["stations"][-1], 0.05))
kappa = [k for k in ans["kappa"] if k is not None]
ok("Krümmungsbild: Plateau bei 1/800 im R-800-Bogen",
   any(near(k, 1 / 800, 0.0001) for k in kappa) and near(max(kappa), 1 / 600, 0.0002))
ok("Krümmungsbild: an den Rändern leer (halbe Sehne)", ans["kappa"][0] is None and ans["kappa"][-1] is None)

# ── 2) Straights by hand ─────────────────────────────────────────────────────

SIMPLE = [("straight", 120, None), ("transition", 50, (None, -700.0)), ("arc", 100, -700.0),
          ("transition", 50, (-700.0, None)), ("straight", 120, None)]
pts = axis_points(SIMPLE, bearing=200.0, seed=3).tolist()
auto = align(pts)
ok("einfacher Bogen automatisch: zwei Geraden, R −700",
   len(auto["straights"]) == 2 and near(auto["curves"][0]["radius"], -700, 1) and auto["auto"])
hand = align(pts, straights=[[0, 90], [340, 430]])
ok("Geraden von Hand: genommen, wie gegeben, nicht automatisch",
   not hand["auto"] and near(hand["straights"][0]["to"], 90, 0.5) and near(hand["straights"][1]["from"], 340, 0.5))
ok("Geraden von Hand: derselbe Bogen", near(hand["curves"][0]["radius"], -700, 1)
   and near(hand["curves"][0]["l1"], 50, 2) and near(hand["curves"][0]["l2"], 50, 2))
one = align(pts, straights=[[0, 90]])
ok("eine Gerade von Hand: der Rest ist ein Bogen am Ende", [c["kind"] for c in one["curves"]] == ["end"]
   and near(one["curves"][0]["radius"], -700, 2))
none = align(pts, straights=[])
ok("keine Gerade: Fehler, aber Krümmung da", none["error"] == "align_error_no_straight"
   and len(none["kappa"]) == len(pts) and none["elements"] is None)
over = align(pts, straights=[[0, 200], [210, 430]])
ok("Geraden von Hand mitten im Bogen: der Bericht zeigt es (> 10 cm)", over.get("error") is None and over["max"] > 0.1)

# ── 3) An offset in the measured axis: two straights, no curve between ──────

pts = axis_points([("straight", 300, None)], bearing=30.0, seed=5)
d = np.array([math.sin(math.radians(30)), math.cos(math.radians(30))])
pts[300:] += 0.12 * np.array([d[1], -d[0]])     # 12 cm to the right from 150 m on
ans = align(pts.tolist())
ok("Versatz: zwei Geraden werden eine, die Stelle genannt",
   ans.get("error") is None and len(ans["straights"]) == 1 and len(ans["merged"]) == 1
   and 100 < ans["merged"][0] < 160)
ok("Versatz: die Abweichung zeigt ihn (≥ 5 cm)", ans["max"] >= 0.05)
hand = align(pts.tolist(), straights=[[0, 140], [160, 299]])
ok("Versatz mit Geraden von Hand: Fehler statt Zusammenfassen", hand.get("error") == "align_error_curve")

# ── 4) Gaps ──────────────────────────────────────────────────────────────────

pts = axis_points(SIMPLE, bearing=200.0, seed=4)
pts = np.concatenate([pts[:150], pts[170:]])     # 10 m missing in the first straight
ans = align(pts.tolist())
ok("Lücke: gemeldet, Fit trotzdem", len(ans["gaps"]) == 1 and near(ans["gaps"][0]["to"] - ans["gaps"][0]["from"], 10.5, 0.2)
   and ans.get("error") is None and near(ans["curves"][0]["radius"], -700, 1.5))

# ── 5) The gradient ──────────────────────────────────────────────────────────

def with_heights(pts, design, step=0.5, noise=0.002, seed=5):
    """The axis points with the heights of `design` at their station, scattered."""
    z = gradient_at(design, np.arange(len(pts)) * step) + np.random.default_rng(seed).normal(0.0, noise, len(pts))
    return np.concatenate([pts, z[:, None]], axis=1)


def gradient_like(got, want, ds, dr):
    """Height points at the same stations (± ds) with the same radii (± dr)."""
    return len(got) == len(want) and all(
        near(g["station"], w["station"], ds) and near(g.get("rv") or 0, w.get("rv") or 0, dr) for g, w in zip(got, want))


DESIGN = [{"station": 0, "z": 100.0}, {"station": 150, "z": 101.5, "rv": 10000},
          {"station": 330, "z": 99.7, "rv": 5000}, {"station": 460, "z": 99.7}]
ans = align(with_heights(axis_points(SIMPLE, bearing=200.0), DESIGN).tolist())
g = ans["gradient"]
ok("Gradiente: zwei Neigungswechsel auf 1 m, Ausrundungen auf 5 %",
   g is not None and gradient_like(g["heights"][1:-1], DESIGN[1:-1], 1.0, 500))
ok("Gradiente: von 0 bis zur Länge der Kette",
   g["heights"][0]["station"] == 0 and near(g["heights"][-1]["station"], sum(e["length"] for e in ans["elements"]), 1e-3))
ok("Gradiente: Abweichung RMS ≤ 3 mm bei 2 mm Streuung", g["rms"] <= 0.003 and len(g["offsets"]) == len(ans["offsets"]))
ok("Gradiente ohne Höhen: keine", align(axis_points(SIMPLE, bearing=200.0).tolist())["gradient"] is None)

# A constant gradient of 30 m between two curves — shorter than the diagram sees.
SHORT = [{"station": 0, "z": 100.0}, {"station": 200, "z": 102.0, "rv": 5000},
         {"station": 280, "z": 101.6, "rv": 5000}, {"station": 500, "z": 101.6}]
s = np.arange(0.0, 500.0, 0.5)
z = gradient_at(SHORT, s) + np.random.default_rng(6).normal(0.0, 0.002, len(s))
g = fit_gradient(s, z, 500.0, 0.02)
ok("kurze Neigung zwischen zwei Ausrundungen gefunden", gradient_like(g["heights"], SHORT, 1.0, 500) and g["max"] <= 0.01)
# The points start inside a vertical curve.
z = gradient_at(DESIGN, s[s >= 120]) + np.random.default_rng(7).normal(0.0, 0.002, (s >= 120).sum())
g = fit_gradient(s[s >= 120] - 120, z, 340.0, 0.02)
ok("Anfang in einer Ausrundung: Abweichung ≤ 1 cm", g["max"] <= 0.01 and len(g["heights"]) >= 3)
z = np.where(np.arange(len(s)) % 3, gradient_at(DESIGN, s), np.nan)
g = fit_gradient(s, z, 460.0, 0.02)
ok("Punkte ohne Höhe: übergangen, ohne Abweichung", g is not None and g["offsets"][0] is None and g["offsets"][1] is not None)

# ── 6) The request ───────────────────────────────────────────────────────────

ok("zu wenig Punkte: Fehlerschlüssel", align_payload({"points": [[0, 0], [1, 1]]})["error"] == "align_error_few_points")
for bad in ({"points": "x"}, {"points": [[0, 0]] * 20, "straights": "x"}, [], {"points": [[0, 0]] * 20, "settings": 3}):
    try:
        align_payload(bad)
        ok(f"ungültig abgelehnt: {bad!r:.40}", False)
    except (ValueError, TypeError):
        ok(f"ungültig abgelehnt: {bad!r:.40}", True)
ans = align_payload({"points": axis_points(SIMPLE, bearing=200.0).tolist(), "settings": {"tolerance": 5, "minLength": None}})
ok("Einstellungen auf ihre Grenzen gehalten", ans["settings"]["tolerance"] == 0.2 and ans["settings"]["minLength"] == 20.0)

print(f"\n{len(FAILED)} failed" if FAILED else "\nall passed")
sys.exit(1 if FAILED else 0)
