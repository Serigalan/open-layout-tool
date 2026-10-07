"""Acceptance for reconnecting existing elements (olt_optimizer/reconnect.py, Paket N).

Every case is a round trip: an ideal chain is built forwards, its axis taken
every centimetre as the app takes it, the elements between two neighbours
handed over as the stretch to replace — and the search has to find a chain
that lies within the tolerance of the old one, holds together and keeps the
rules where it can.

    WEBSITE/.venv/bin/python tools/optimizer/tests/verify_reconnect.py
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import _arc_forward, transition_end                  # noqa: E402
from olt_optimizer.reconnect import chain_polyline, reconnect_payload             # noqa: E402
from olt_optimizer.splice import arc, straight, transition                        # noqa: E402
from chain_check import chain_holds                                              # noqa: E402

FAILED = []
MODEL = {"coeff": 6.5, "defCoeff": 11.8, "defMin": 60, "max": 160, "step": 5}
P0 = (500000.0, 5600000.0)


def ok(label, cond):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILED.append(label)


def along(p, bearing, length):
    return (p[0] + length * math.sin(math.radians(bearing)), p[1] + length * math.cos(math.radians(bearing)))


def build(specs, start=P0, bearing=90.0, profile="clothoid"):
    """An ideal chain: specs ('s', L) | ('a', L, R) | ('t', L, r1, r2)."""
    els, p, b = [], start, bearing
    for s in specs:
        if s[0] == "s":
            q = along(p, b, s[1])
            els.append(straight(p, q, "old"))
            p = q
        elif s[0] == "a":
            q, nb = _arc_forward(p[0], p[1], b, s[2], s[1] / abs(s[2]))
            els.append(arc(p, q, s[2], "old"))
            p, b = q, nb
        else:
            e, n, nb = transition_end(p[0], p[1], b, s[1], s[2], s[3], profile)
            els.append(transition(p, b, s[1], s[2], s[3], profile, end=(e, n), end_bearing=nb))
            p, b = (e, n), nb
    return els


def end_bearing(el):
    return el.get("endBearing", el["bearing"])


def as_pick(el, join_at, virtual=False):
    """An element as the app hands it over: its ends, the bearing at its end,
    its radius — or, `virtual`, the point it ends in (a transition, a switch)."""
    if virtual:
        at = el["endNode"] if join_at == "end" else el["startNode"]
        r = (el.get("r2") if join_at == "end" else el.get("r1")) if el["elementType"] == 2 else el.get("radius")
        b = end_bearing(el) if join_at == "end" else el["bearing"]
        return {"start": list(at), "end": list(at), "bearing": b, "radius": r, "length": 0, "joinAt": join_at}
    return {"start": list(el["startNode"]), "end": list(el["endNode"]), "bearing": end_bearing(el),
            "radius": el.get("radius"), "length": el["length"], "joinAt": join_at}


def points_of(els):
    """The axis every centimetre, packed as the app sends it."""
    poly = chain_polyline(els)
    st = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(poly, axis=0).T))])
    s = np.arange(0.0, st[-1], 0.01)
    s = np.append(s, st[-1])
    e = np.interp(s, st, poly[:, 0])
    n = np.interp(s, st, poly[:, 1])
    e0, n0 = float(e[0]), float(n[0])
    return {"e0": e0, "n0": n0, "de": np.round((e - e0) * 1000).astype(int).tolist(),
            "dn": np.round((n - n0) * 1000).astype(int).tolist()}


def ask(els, dep_i, arr_i, tol, speed, virtual=(False, False), **kw):
    dep = as_pick(els[dep_i], "end", virtual[0])
    arr = as_pick(els[arr_i], "start", virtual[1])
    lo = dep_i + (1 if virtual[0] else 0)
    hi = arr_i - (1 if virtual[1] else 0)
    req = {"dep": dep, "arr": arr, "points": points_of(els[lo:hi + 1]), "tolerance": tol, "speed": speed,
           "cantModel": MODEL, "lMin": 0.4 * speed if speed else 0, **kw}
    t0 = time.monotonic()
    ans = reconnect_payload(req)
    return ans, time.monotonic() - t0


def holds(sol):
    why = chain_holds(sol["elements"])
    if why:
        print("   chain:", why)
    return why is None


def describe(sol):
    r = sol["reconnect"]
    return (f"{r['variant']} R={r['radius']} u={r['cant']} max={r['max'] * 100:.1f} cm "
            f"rms={r['rms'] * 100:.1f} cm within={r['within']} worst={sol['worst']}")


def main():
    # ── a curve between two straights ────────────────────────────────────────────
    curve = build([("s", 200), ("t", 60, None, 800.0), ("a", 300, 800.0), ("t", 60, 800.0, None), ("s", 200)])
    ans, dt = ask(curve, 0, 4, 0.10, 100)
    ok("curve: answers solutions", "solutions" in ans)
    best = ans["solutions"][0]
    print("   ", describe(best), f"{dt:.1f}s")
    ok("curve: best lies within 10 cm", best["reconnect"]["within"])
    ok("curve: best radius near 800", abs(best["reconnect"]["radius"] - 800) < 40)
    ok("curve: best chain holds together", holds(best))
    ok("curve: no error on the best", best["worst"] != "error")
    ok("curve: every variant answered", len(ans["solutions"]) == 3)
    ok("curve: band covers the stretch", ans["solutions"][0]["reconnect"]["band"][-1][0] > 600)
    ok("curve: the dep and arr ends stay where they were",
       math.dist(best["elements"][0]["startNode"], curve[0]["startNode"]) < 1e-6
       and math.dist(best["elements"][-1]["endNode"], curve[4]["endNode"]) < 1e-6)
    ok("curve: answered within 10 s", dt < 10)

    # A tolerance nothing meets: the best is still named, flagged.
    ans, _ = ask(curve, 0, 4, 0.0005, 160)
    ok("tight: flagged beyond the tolerance", "solutions" in ans and not ans["solutions"][0]["reconnect"]["within"])

    # A radius given is kept.
    ans, _ = ask(curve, 0, 4, 0.50, 100, radius=900)
    ok("fixed radius: every solution at R 900", all(s["reconnect"]["radius"] == 900 for s in ans["solutions"]))

    # ── an arc without transitions, slow: no transition fits best ────────────────
    plain = build([("s", 150), ("a", 200, -1900.0), ("s", 150)])
    ans, _ = ask(plain, 0, 2, 0.05, 60)
    best = ans["solutions"][0]
    print("   ", describe(best))
    ok("plain arc: within 5 cm", best["reconnect"]["within"])
    ok("plain arc: radius near 1900", abs(abs(best["reconnect"]["radius"]) - 1900) < 60)

    # ── neighbours that may not be re-shaped (a switch's) stay, the splice
    # builds on from their ends ───────────────────────────────────────────────────
    ans, dt = ask(curve, 0, 4, 0.15, 100, virtual=(True, True))
    ok("fixed neighbours: answered", "solutions" in ans)
    if "solutions" in ans:
        best = ans["solutions"][0]
        print("   ", describe(best), f"{dt:.1f}s")
        ok("fixed neighbours: within", best["reconnect"]["within"])
        ok("fixed neighbours: holds", holds(best))
        ok("fixed neighbours: starts and ends where they end",
           math.dist(best["elements"][0]["startNode"], curve[0]["endNode"]) < 1e-6
           and math.dist(best["elements"][-1]["endNode"], curve[4]["startNode"]) < 1e-6)

    # Two ends on one circle — an arc between two transitions, kept: nothing to
    # choose, and said so.
    ans, _ = ask(curve, 1, 3, 0.10, 100, virtual=(True, True))
    ok("one circle: said so", ans.get("error") == "reconnect_error_same_circle")

    # ── an arc and a straight ────────────────────────────────────────────────────
    arcs = build([("a", 150, 600.0), ("t", 40, 600.0, None), ("s", 100), ("t", 40, None, 900.0), ("a", 150, 900.0)])
    ans, dt = ask(arcs, 0, 2, 0.10, 80)
    ok("arc and straight: answered", "solutions" in ans)
    if "solutions" in ans:
        best = ans["solutions"][0]
        print("   ", describe(best), f"{dt:.1f}s")
        ok("arc and straight: holds", holds(best))

    # ── two arcs ─────────────────────────────────────────────────────────────────
    ans, dt = ask(arcs, 0, 4, 0.10, 80)
    ok("two arcs: answered", "solutions" in ans)
    if "solutions" in ans:
        best = ans["solutions"][0]
        print("   ", describe(best), f"{dt:.1f}s")
        ok("two arcs: within", best["reconnect"]["within"])
        ok("two arcs: holds", holds(best))
        ok("two arcs: at least the three over a straight", len(ans["solutions"]) >= 3)

    # ── a reverse curve does not fit one arc ─────────────────────────────────────
    s_curve = build([("s", 100), ("a", 120, 500.0), ("a", 120, -500.0), ("s", 100)])
    ans, _ = ask(s_curve, 0, 3, 0.05, 60)
    ok("reverse curve: beyond 5 cm, the best still named",
       "solutions" in ans and not ans["solutions"][0]["reconnect"]["within"]
       or ans.get("error") == "reconnect_error_no_fit")

    if FAILED:
        print(f"\n{len(FAILED)} FAILED")
        sys.exit(1)
    print("\nall passed")


if __name__ == "__main__":
    main()
