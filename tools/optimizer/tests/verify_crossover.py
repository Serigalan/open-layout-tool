"""Acceptance for solving a switch connection (olt_optimizer/crossover.py, Paket WV).

The branch ends are built here as the app would sample them, for a form that
is one arc (500 – 1:12: R 500, 1:12) laid into two straight tracks: track 1
along +y, track 2 to its left, parallel or at an angle. The search has to find
connections that close on the second branch, keep every limit it was given,
and come back best first — or say that none fits where the branches overlap.

    .venv/bin/python tools/optimizer/tests/verify_crossover.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.crossover import (                                              # noqa: E402
    BranchEnd, Problem, Template, crossover_payload, piece_end, _rank,
)

FAILED = []

R, N = 500.0, 12.0
W = math.atan(1.0 / N)
SPEED = 60.0
LIMITS = {"lMin": 6.0, "rwReg": 490.0, "rwDiscretion": 400.0, "maxCantDef": 100.0,
          "cantDefCoeff": 11.8, "cantTol": 1.0}


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


def left_arc(x, y, psi, k, length):
    return (x + (math.sin(psi + k * length) - math.sin(psi)) / k,
            y - (math.cos(psi + k * length) - math.cos(psi)) / k, psi + k * length)


def form(gap, angle_deg=0.0, reach=100.0, step=0.5):
    """Samples of both branch ends: turnout 1 on x = 0 (running +y), turnout 2
    on a line through (−gap, 0) heading π/2 + angle, opening back towards −y;
    both branches turn towards the other track."""
    a = math.radians(angle_deg)
    n = int(round(2 * reach / step))
    s_all = [-reach + i * step for i in range(n + 1)]
    first, second = [], []
    for s in s_all:
        x, y, psi = left_arc(0.0, s, math.pi / 2, 1.0 / R, R * W)
        first.append({"s": s, "x": x, "y": y, "psi": psi, "kappa": 1.0 / R, "tail": 0.0,
                      "cantLds": 0.0, "ok": True})
        px, py = -gap - s * math.sin(a), s * math.cos(a)
        x2, y2, psi2 = left_arc(px, py, -math.pi / 2 + a, 1.0 / R, R * W)
        second.append({"s": s, "x": x2, "y": y2, "psi": psi2 + math.pi, "kappa": -1.0 / R,
                       "tail": 0.0, "cantLds": 0.0, "ok": True})
    return {"label": "500 – 1:12", "first": first, "second": second}


def check_solutions(label, payload, answer):
    sols = answer.get("solutions") or []
    ok(f"{label}: solutions found", len(sols) > 0)
    f = payload["forms"][0]
    problem = Problem(BranchEnd(f["first"]), BranchEnd(f["second"]), payload["limits"], payload["speed"])
    for sol in sols:
        tpl = Template(tuple(sol["template"]))
        z = [sol["s1"], sol["s2"]]
        for i, slot in tpl.slots:
            piece = sol["pieces"][i]
            z.append(piece["length"] if slot == "length" else piece["kappa"] * 1e3)
        r = problem.residual(tpl, z)
        ok(f"{label} {'+'.join(tpl.types)}: closes on the second branch", math.hypot(r[0], r[1]) < 1e-4)
        ok(f"{label} {'+'.join(tpl.types)}: keeps every limit", min(problem.inequalities(tpl, z)) >= -1e-7)
        ok(f"{label} {'+'.join(tpl.types)}: each element at least l_min",
           all(p["length"] >= LIMITS["lMin"] - 1e-6 for p in sol["pieces"]))
    ok(f"{label}: best first", [_rank(s) for s in sols] == sorted(_rank(s) for s in sols))
    return sols


def main():
    # A clothoid piece integrated against its arc: equal curvatures are an arc.
    x, y, psi = piece_end(0.0, 0.0, 0.3, 40.0, 1 / 300.0, 1 / 300.0 + 1e-12)
    ax, ay, apsi = left_arc(0.0, 0.0, 0.3, 1 / 300.0, 40.0)
    ok("piece_end: a clothoid of no change is the arc", math.hypot(x - ax, y - ay) < 1e-9 and abs(psi - apsi) < 1e-12)
    # A clothoid from straight to 1/300 over 60 m turns by 0.1 rad.
    _, _, psi = piece_end(0.0, 0.0, 0.0, 60.0, 0.0, 1 / 300.0)
    ok("piece_end: a clothoid turns by the mean curvature times its length", abs(psi - 0.1) < 1e-12)

    # Parallel at 4.0 m: the classical crossover, a straight of 6.57 m —
    # the one arc with no curvature, next to the click.
    payload = {"speed": SPEED, "limits": LIMITS, "forms": [form(4.0)]}
    sols = check_solutions("parallel 4.0 m", payload, crossover_payload(payload))
    single = [s for s in sols if s["template"] == ["arc"]]
    ok("parallel 4.0 m: the one arc stands at the click", bool(single) and abs(single[0]["s1"]) < 0.5)
    ok("parallel 4.0 m: it is the straight of 6.57 m",
       bool(single) and abs(single[0]["pieces"][0]["length"] - 6.57) < 0.05
       and abs(single[0]["pieces"][0]["kappa"]) < 1e-6)

    # Converging by 1.5°, 7 m apart at the click: one arc between the
    # branches would jump below the comparison radius; a chain does not.
    payload = {"speed": SPEED, "limits": LIMITS, "forms": [form(7.0, -1.5)]}
    sols = check_solutions("converging 1.5°", payload, crossover_payload(payload))
    ok("converging 1.5°: a chain of more than one element among them", any(len(s["pieces"]) > 1 for s in sols))

    # 2.5 m apart: the two branches alone cover 3.45 m — nothing fits.
    payload = {"speed": SPEED, "limits": LIMITS, "forms": [form(2.5, reach=40.0)]}
    ok("2.5 m apart: no solution", crossover_payload(payload).get("error") == "no_solution")

    print()
    if FAILED:
        print(f"{len(FAILED)} failed")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
