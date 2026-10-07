"""Property test bench for "Zwei Gleise zusammenfügen" (Paket S, AP S.1).

verify_splice.py checks hand-picked geometries, one per case. Here the
geometries are drawn at random — an ideal chain is built forwards in every
case the service knows (two straights, an arc and a straight, two arcs over a
straight, two arcs over one transition), its outer elements are cut back by a
random gap and handed over as the two picks — and each one is asked in all
the ways a user can ask it: both click orders, each track stored in either
direction. The invariants:

  holds       the chain answered for the order and direction it was built in
              runs from the departure's start to the arrival's end, every
              element true to its figures, no gap, no kink, no curvature
              jump where a transition meets its neighbours, and it finds the
              chain that was built (round trip)
  order       every way of asking finds a solution, and the same one — the
              order of the clicks and the direction a track is stored in
              decide nothing (AP S.2)
  regular     asked with the Regellänge, every transition the splice inserts
              is as long as the rules ask for its neighbours in the chain
              that came back, and the catalogue finds nothing on the stretch
              it inserts worse than its Regelwert lets pass (AP S.3, S.4)

An invariant that belongs to a work package not built yet is reported, not
enforced: the bench was written first (AP S.1) and each AP turns its own on.

    WEBSITE/.venv/bin/python tools/optimizer/tests/verify_splice_props.py [--n 40] [--seed 1]
"""

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.geometry import _arc_forward, transition_end          # noqa: E402
from olt_optimizer.grenzen import transition_lengths                     # noqa: E402
from olt_optimizer.pruefung import check_track                           # noqa: E402
from olt_optimizer.regelwerk import load_katalog                         # noqa: E402
from olt_optimizer.splice import splice_payload                          # noqa: E402
from chain_check import chain_holds, near                                # noqa: E402

# Which invariants are enforced, and the AP that turns on those that are not.
ENFORCED = {"holds": None, "order": None, "regular": "S.3"}

P0 = (600000.0, 5700000.0)


# ── building ideal chains ────────────────────────────────────────────────────

def along(p, bearing, s):
    return (p[0] + s * math.sin(math.radians(bearing)), p[1] + s * math.cos(math.radians(bearing)))


def arc_on(p, bearing, r, s):
    """Point and bearing `s` metres along an arc of signed `r` (negative: back)."""
    if s >= 0:
        return _arc_forward(p[0], p[1], bearing, r, s / abs(r))
    q, b = _arc_forward(p[0], p[1], (bearing + 180.0) % 360.0, -r, -s / abs(r))
    return q, (b + 180.0) % 360.0


def straight_pick(start, bearing, length):
    return {"start": list(start), "end": list(along(start, bearing, length)), "bearing": bearing,
            "startBearing": bearing, "radius": None}


def arc_pick(start, bearing, r, length):
    end, b = arc_on(start, bearing, r, length)
    return {"start": list(start), "end": list(end), "bearing": b, "startBearing": bearing, "radius": r}


def flipped(p):
    """The pick of the same element stored the other way round."""
    return {"start": p["end"], "end": p["start"], "bearing": (p["startBearing"] + 180.0) % 360.0,
            "startBearing": (p["bearing"] + 180.0) % 360.0,
            "radius": -p["radius"] if p["radius"] is not None else None,
            **{k: v for k, v in p.items() if k in ("cant", "speed")}}


def service_pick(p):
    return {k: v for k, v in p.items() if k != "startBearing"}


def side(rng):
    return rng.choice((1.0, -1.0))


def gap(rng):
    """How far a pick stops short of the junction [m]: mostly a gap, sometimes none."""
    return 0.0 if rng.random() < 0.2 else rng.uniform(1.0, 40.0)


def case_straights(rng):
    b0 = rng.uniform(0, 360)
    r = rng.uniform(250, 3000) * side(rng)
    theta = math.radians(rng.uniform(20, 140))
    l1 = 0.0 if rng.random() < 0.3 else rng.uniform(20, 100)
    l2 = l1 if rng.random() < 0.5 else (0.0 if l1 == 0 else rng.uniform(20, 100))
    # The transitions turn by l/2R each; the arc takes what is left.
    sweep = theta - (l1 + l2) / (2 * abs(r))
    if sweep < 0.05:
        return None
    t1 = P0
    e, n, b = transition_end(t1[0], t1[1], b0, l1, None, r) if l1 else (t1[0], t1[1], b0)
    a1 = (e, n)
    a2, b = arc_on(a1, b, r, sweep * abs(r))
    e, n, b = transition_end(a2[0], a2[1], b, l2, r, None) if l2 else (a2[0], a2[1], b)
    t2 = (e, n)
    g1, g2 = gap(rng), gap(rng)
    la, lb = rng.uniform(60, 300), rng.uniform(60, 300)
    dep = straight_pick(along(t1, b0, -(la + g1)), b0, la)
    arr = straight_pick(along(t2, b, g2), b, lb)
    req = {"radius": abs(r), "lDep": l1, "lArr": l2, "transition": "clothoid", "arcJoin": "straight"}
    return {"kind": "straights", "dep": dep, "arr": arr, "req": req, "radius": r, "arc": (a1, a2)}


def case_arc_straight(rng):
    b0 = rng.uniform(0, 360)
    ra = rng.uniform(300, 2500) * side(rng)
    rn = rng.uniform(300, 2500) * side(rng)
    if abs(abs(ra) - abs(rn)) < 50:
        return None
    l1 = 0.0 if rng.random() < 0.3 else rng.uniform(20, 80)
    l2 = 0.0 if rng.random() < 0.3 else rng.uniform(20, 80)
    sweep = rng.uniform(80, 400)
    j = P0
    g1, g2 = rng.uniform(0, 10), gap(rng)
    la, lb = rng.uniform(60, 250), rng.uniform(60, 300)
    dep_start, dep_b = arc_on(j, b0, ra, -(la + g1))
    dep = arc_pick(dep_start, dep_b, ra, la)
    e, n, b = transition_end(j[0], j[1], b0, l1, ra, rn) if l1 else (j[0], j[1], b0)
    a1 = (e, n)
    a2, b = arc_on(a1, b, rn, sweep)
    e, n, b = transition_end(a2[0], a2[1], b, l2, rn, None) if l2 else (a2[0], a2[1], b)
    arr = straight_pick(along((e, n), b, g2), b, lb)
    req = {"radius": abs(rn), "lDep": l1, "lArr": l2, "transition": "clothoid", "arcJoin": "straight"}
    return {"kind": "arc+straight", "dep": dep, "arr": arr, "req": req, "radius": rn, "arc": (a1, a2)}


def case_arcs_straight(rng):
    b0 = rng.uniform(0, 360)
    r1 = rng.uniform(300, 2500) * side(rng)
    r2 = rng.uniform(300, 2500) * side(rng)
    l1 = 0.0 if rng.random() < 0.3 else rng.uniform(20, 80)
    l2 = 0.0 if rng.random() < 0.3 else rng.uniform(20, 80)
    s = rng.uniform(20, 200)
    j1 = P0
    g1, g2 = gap(rng), gap(rng)
    la, lb = rng.uniform(60, 250), rng.uniform(60, 250)
    dep_start, dep_b = arc_on(j1, b0, r1, -(la + g1))
    dep = arc_pick(dep_start, dep_b, r1, la)
    e, n, b = transition_end(j1[0], j1[1], b0, l1, r1, None) if l1 else (j1[0], j1[1], b0)
    s2 = along((e, n), b, s)
    e, n, b = transition_end(s2[0], s2[1], b, l2, None, r2) if l2 else (s2[0], s2[1], b)
    arr_start, arr_b = arc_on((e, n), b, r2, g2)
    arr = arc_pick(arr_start, arr_b, r2, lb)
    req = {"radius": 0, "lDep": l1, "lArr": l2, "transition": "clothoid", "arcJoin": "straight"}
    return {"kind": "arcs+straight", "dep": dep, "arr": arr, "req": req, "straight": s}


def case_arcs_transition(rng):
    b0 = rng.uniform(0, 360)
    r1 = rng.uniform(300, 2500) * side(rng)
    compound = rng.random() < 0.5
    if compound:
        r2 = math.copysign(abs(r1) * rng.choice((rng.uniform(1.3, 3.0), 1 / rng.uniform(1.3, 3.0))), r1)
    else:
        r2 = -math.copysign(rng.uniform(300, 2500), r1)
    length = rng.uniform(20, 120)
    j1 = P0
    g1, g2 = gap(rng), gap(rng)
    la, lb = rng.uniform(60, 250), rng.uniform(60, 250)
    dep_start, dep_b = arc_on(j1, b0, r1, -(la + g1))
    dep = arc_pick(dep_start, dep_b, r1, la)
    e, n, b = transition_end(j1[0], j1[1], b0, length, r1, r2)
    arr_start, arr_b = arc_on((e, n), b, r2, g2)
    arr = arc_pick(arr_start, arr_b, r2, lb)
    req = {"radius": 0, "lDep": 0, "lArr": 0, "transition": "clothoid", "arcJoin": "transition"}
    return {"kind": "arcs+transition", "dep": dep, "arr": arr, "req": req, "transition": length}


FAMILIES = [case_straights, case_arc_straight, case_arcs_straight, case_arcs_transition]


# ── reading answers ──────────────────────────────────────────────────────────

def best(answer):
    """The solution an answer proposes, or None for an error."""
    if "error" in answer:
        return None
    if "solutions" in answer:
        return answer["solutions"][0]
    return answer


def nodes(sol):
    els = sol["elements"]
    return [tuple(els[0]["startNode"])] + [tuple(el["endNode"]) for el in els]


def same_chain(a, b, tol=1e-3):
    """Two chains alike, in either direction."""
    na, nb = nodes(a), nodes(b)
    if len(na) != len(nb):
        return False
    if all(near(p, q, tol) for p, q in zip(na, nb)):
        return True
    return all(near(p, q, tol) for p, q in zip(na, reversed(nb)))


def curvature_jumps(els):
    """Where a transition does not meet its neighbour's curvature."""
    def k(r):
        return 0.0 if not r else 1.0 / r

    def k_end(el):
        return k(el.get("r2")) if el["elementType"] == 2 else k(el.get("radius"))

    def k_start(el):
        return k(el.get("r1")) if el["elementType"] == 2 else k(el.get("radius"))
    out = []
    for i in range(len(els) - 1):
        a, b = els[i], els[i + 1]
        if 2 in (a["elementType"], b["elementType"]) and abs(k_end(a) - k_start(b)) > 1e-9:
            out.append(i)
    return out


def round_trip(case, sol):
    """Does the chain answered contain what was built between the picks?"""
    els = sol["elements"]
    if case["kind"] in ("straights", "arc+straight"):
        arcs = [el for el in els if el.get("role") == "new" and el["elementType"] == 1]
        if len(arcs) != 1:
            return f"{len(arcs)} new arcs"
        a1, a2 = case["arc"]
        if abs(arcs[0]["radius"] - case["radius"]) > 1e-6:
            return f"radius {arcs[0]['radius']:.3f} for {case['radius']:.3f}"
        if not (near(arcs[0]["startNode"], a1, 1e-3) and near(arcs[0]["endNode"], a2, 1e-3)):
            return "the new arc lies elsewhere"
    elif case["kind"] == "arcs+straight":
        new = [el for el in els if el.get("role") == "new" and el["elementType"] == 0]
        if len(new) != 1 or abs(new[0]["length"] - case["straight"]) > 1e-3:
            return "another straight between the arcs"
    else:
        new = [el for el in els if el.get("role") == "new"]
        if len(new) != 1 or abs(new[0]["length"] - case["transition"]) > 1e-3:
            return "another transition between the arcs"
    return None


def with_speed(case, rng):
    """The case asked with a design speed and the Regellänge on both sides:
    every curve gets a cant and a speed it carries without a deficiency
    beyond 100 mm, the picks theirs, the new arc the dialog's."""
    radii = [abs(p["radius"]) for p in (case["dep"], case["arr"]) if p["radius"] is not None]
    if case.get("radius"):
        radii.append(abs(case["radius"]))
    u = {r: rng.choice((0, 20, 40, 60, 80, 100)) for r in radii}
    v = min([160] + [math.sqrt(r * (u[r] + 100) / 11.8) for r in radii])
    v = max(40, 5 * math.floor(v / 5))

    def canted(p):
        return {**p, "speed": v, "cant": u[abs(p["radius"])] if p["radius"] is not None else 0}
    req = {**case["req"], "speed": v, "modeDep": "regular", "modeArr": "regular"}
    if case.get("radius"):
        req["cant"] = u[abs(case["radius"])]
    return {**case, "dep": canted(case["dep"]), "arr": canted(case["arr"]), "req": req}


KATALOG = load_katalog()


def regular_holds(sol):
    """Is every inserted transition as long as the rules ask for between its
    neighbours, and nothing on the stretch worse than its Regelwert lets pass?"""
    els = sol["elements"]
    if any(el.get("speed") is None for el in els):
        return "the chain carries no speed"
    for i, el in enumerate(els):
        if el.get("role") != "new" or el["elementType"] != 2:
            continue
        want = transition_lengths(els[i - 1] if i else None, els[i + 1] if i + 1 < len(els) else None,
                                  el.get("r1"), el.get("transitionType", "clothoid"), el["speed"])["regular"]
        if want is None or abs(el["length"] - want) > 1e-6:
            return f"transition {i}: {el['length']:.2f} m, the Regellänge {want}"
    new = [i for i, el in enumerate(els) if el.get("role") == "new"]
    bad = [f for f in check_track(KATALOG, els, new) if KATALOG.rank(f[2]) > KATALOG.rank("ok")]
    flagged = any(KATALOG.rank(f.get("severity")) >= KATALOG.rank("error") for f in sol.get("findings", []))
    errors = [f for f in bad if KATALOG.rank(f[2]) >= KATALOG.rank("error")]
    if errors and not flagged:
        return f"{errors[0][1]} {errors[0][2]} at {errors[0][0]}, not reported"
    if not errors and bad and not sol.get("findings"):
        return f"{bad[0][1]} {bad[0][2]} at {bad[0][0]}, not reported"
    return None


# ── the bench ────────────────────────────────────────────────────────────────

def variants(case):
    """Every way to ask: (label, first pick, second pick)."""
    p, q = case["dep"], case["arr"]
    out = []
    for fp in (False, True):
        for fq in (False, True):
            pp = flipped(p) if fp else p
            qq = flipped(q) if fq else q
            tag = ("P~" if fp else "P") + ("Q~" if fq else "Q")
            out.append((tag, pp, qq, False))
            out.append((tag + " swapped", qq, pp, True))
    return out


def asked(req, first, second, swapped):
    """The request with the picks in this order — each keeps its own transition."""
    out = {**req, "dep": service_pick(first), "arr": service_pick(second)}
    if swapped:
        out["lDep"], out["lArr"] = req.get("lArr", 0), req.get("lDep", 0)
        if "modeDep" in req:
            out["modeDep"], out["modeArr"] = req["modeArr"], req["modeDep"]
    return out


def run(n, seed, verbose):
    rng = random.Random(seed)
    stats = {name: [0, 0] for name in ENFORCED}        # [checked, violated]
    examples = {name: [] for name in ENFORCED}

    def report(name, label, why):
        stats[name][1] += 1
        if len(examples[name]) < 5:
            examples[name].append(f"{label}: {why}")

    for family in FAMILIES:
        made = 0
        while made < n:
            case = family(rng)
            if case is None:
                continue
            made += 1
            label = f"{case['kind']} #{made}"
            base = splice_payload({**case["req"], "dep": service_pick(case["dep"]), "arr": service_pick(case["arr"])})
            sol = best(base)
            stats["holds"][0] += 1
            if sol is None:
                report("holds", label, f"no solution ({base.get('error')})")
                continue
            why = chain_holds(sol["elements"])
            if why is None and not (near(sol["elements"][0]["startNode"], case["dep"]["start"], 1e-6)
                                    and near(sol["elements"][-1]["endNode"], case["arr"]["end"], 1e-6)):
                why = "does not run from the departure's start to the arrival's end"
            if why is None and curvature_jumps(sol["elements"]):
                why = f"curvature jump after element {curvature_jumps(sol['elements'])[0]}"
            if why is None:
                why = round_trip(case, sol)
            if why:
                report("holds", label, why)
                continue
            for tag, first, second, swapped in variants(case):
                stats["order"][0] += 1
                other = best(splice_payload(asked(case["req"], first, second, swapped)))
                if other is None:
                    report("order", f"{label} {tag}", "no solution")
                elif not same_chain(sol, other):
                    report("order", f"{label} {tag}", "another chain")
            reg = with_speed(case, rng)
            stats["regular"][0] += 1
            try:
                answer = splice_payload({**reg["req"], "dep": service_pick(reg["dep"]), "arr": service_pick(reg["arr"])})
            except (ValueError, KeyError, TypeError) as exc:
                report("regular", label, f"refused: {exc!r}")
                continue
            sol = best(answer)
            if sol is not None:
                why = chain_holds(sol["elements"]) or regular_holds(sol)
                if why:
                    report("regular", f"{label} at {reg['req']['speed']} km/h", why)
    return stats, examples


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=40, help="cases per family")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args()
    stats, examples = run(args.n, args.seed, args.v)
    failed = False
    for name, (checked, violated) in stats.items():
        pending = ENFORCED[name]
        state = "ok" if not violated else ("pending AP " + pending if pending else "FAIL")
        print(f"{name:8s} {checked - violated}/{checked} hold — {state}")
        for ex in examples[name]:
            print("         ", ex)
        if violated and not pending:
            failed = True
    print("\nall enforced invariants hold" if not failed else "\nFAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
