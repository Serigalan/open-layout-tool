"""Writes src/core/utils/splice/serviceAnswers.json: what the service answers
to splices, for the app's splice (src/core/utils/splice/solveSplice.js,
decision 294) to be held against (solveSplice.test.js). The geometries
are those of the property bench (verify_splice_props.py) — two straights, an
arc and a straight, two arcs over a straight, two arcs over one transition —
asked in the ways a user can ask them: without transitions in both click
orders and with each track stored either way, with the transitions they were
built with, at the Regellänge with a design speed, two arcs joined the other
way too, and with a radius far too large. The spacing to a neighbour is the
service's alone (decision 295) and is not asked here. Run again after changing splice.py:

    .venv/bin/python tools/optimizer/tests/splice_answers_fixture.py [--n 6] [--seed 7]

With --check it writes nothing and fails where the service now answers other
than the file says — splice.py changed in a way the app's splice has not
followed (CI runs it so).
"""

import argparse
import json
import os
import pathlib
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from olt_optimizer.splice import splice_payload                                       # noqa: E402
from verify_splice_props import (                                                       # noqa: E402
    case_arc_straight, case_arcs_straight, case_arcs_transition, case_straights, flipped, service_pick,
)

FAMILIES = [case_straights, case_arc_straight, case_arcs_straight, case_arcs_transition]

# A design speed and the cant of a picked arc, where the rules set the lengths [km/h, mm].
SPEED, CANT = 80.0, 60.0

ROOT = pathlib.Path(__file__).resolve().parents[3]


def trimmed(answer):
    """What the app's splice is compared on: every solution in the service's
    order, by its ends, direction, cost, chain, the transition beside each
    pick and what the catalogue finds; or the error with what would fit."""
    def side(length):
        return {k: length.get(k) for k in ("mode", "length", "regular", "minimum")}

    sols = answer.get("solutions", [])
    if not sols:
        return {"error": answer["error"], "params": answer.get("params", {}),
                "lengths": [side(x) for x in answer.get("lengths", [])]}
    out = {"solutions": [{
        "ends": s["ends"], "depPick": s["depPick"], "reverseDep": s["reverseDep"], "reverseArr": s["reverseArr"],
        "rebuilt": s["rebuilt"], "alternative": s.get("alternative", False), "arcJoin": s.get("arcJoin"),
        "lengths": [side(x) for x in s["lengths"]],
        "findings": [[f["at"], f["id"], f["severity"]] for f in s["findings"]], "worst": s["worst"], "judged": s["judged"],
        "elements": [{k: el[k] for k in ("elementType", "role", "startNode", "endNode", "radius", "r1", "r2", "length")
                      if k in el} for el in s["elements"]],
    } for s in sols]}
    if answer.get("requested"):
        out["requested"] = answer["requested"]
    return out


def differs(old, new, path="answer"):
    """Where two answers part, beyond the rounding of another platform: nodes
    and lengths to 1e-6, a radius that would fit to the metre — or None."""
    if isinstance(old, dict) and isinstance(new, dict):
        if old.keys() != new.keys():
            return f"{path}: {sorted(old)} != {sorted(new)}"
        for k in old:
            tol = 1.0 if k in ("rMax", "rMin") else None
            d = differs(old[k], new[k], f"{path}.{k}") if tol is None else (
                None if abs(old[k] - new[k]) <= tol else f"{path}.{k}: {old[k]} != {new[k]}")
            if d:
                return d
        return None
    if isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            return f"{path}: {len(old)} != {len(new)} entries"
        return next((d for i, (a, b) in enumerate(zip(old, new)) if (d := differs(a, b, f"{path}[{i}]"))), None)
    if isinstance(old, float) or isinstance(new, float):
        return None if abs(old - new) <= 1e-6 * max(1.0, abs(old)) else f"{path}: {old} != {new}"
    return None if old == new else f"{path}: {old!r} != {new!r}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    cases = []

    def ask(name, req, p, q):
        request = {**req, "dep": service_pick(p), "arr": service_pick(q)}
        cases.append({"name": name, "request": request, "answer": trimmed(splice_payload(request))})

    for family in FAMILIES:
        made = 0
        while made < args.n:
            case = family(rng)
            if case is None:
                continue
            made += 1
            name = f"{case['kind']} #{made}"
            req, dep, arr = case["req"], case["dep"], case["arr"]
            plain = {**req, "lDep": 0, "lArr": 0}
            for way, (p, q) in {"asBuilt": (dep, arr), "clickedBack": (arr, dep),
                                "depStoredBack": (flipped(dep), arr), "arrStoredBack": (dep, flipped(arr))}.items():
                ask(f"{name} plain {way}", plain, p, q)
            if req["lDep"] or req["lArr"]:
                # The transitions the chain was built with, as given.
                ask(f"{name} transitions asBuilt", req, dep, arr)
                ask(f"{name} transitions clickedBack", {**req, "lDep": req["lArr"], "lArr": req["lDep"]}, arr, dep)
                ask(f"{name} transitions bloss", {**req, "transitionDep": "bloss", "transitionArr": "bloss"}, dep, arr)
            # At the Regellänge on both sides, with a design speed and canted arcs.
            canted = [{**x, "speed": SPEED, **({"cant": CANT} if x["radius"] else {})} for x in (dep, arr)]
            regular = {**req, "lDep": 60, "lArr": 60, "modeDep": "regular", "modeArr": "regular", "speed": SPEED,
                       "cant": CANT if req["radius"] else 0}
            # Transitions far too long for the room there is: the longest that fit.
            ask(f"{name} longTransitions", {**req, "lDep": 400, "lArr": 400}, dep, arr)
            if case["kind"] == "arcs+straight":
                # Asked for one transition from arc to arc: the straight they were built with beside it.
                ask(f"{name} askedDirect", {**plain, "arcJoin": "transition", "speed": SPEED}, *canted)
            if req.get("arcJoin") != "transition":
                ask(f"{name} regular", regular, *canted)
                ask(f"{name} minimum", {**regular, "modeDep": "minimum", "modeArr": "minimum"}, *canted)
            else:
                # Asked for one transition, and the straight offered beside it at the Regellänge.
                ask(f"{name} direct speed", {**plain, "speed": SPEED}, *canted)
                ask(f"{name} direct clickedBack", plain, arr, dep)
            if req["radius"]:
                # A radius far too large: what would fit instead.
                ask(f"{name} tooLarge", {**plain, "radius": req["radius"] * 15}, dep, arr)
                ask(f"{name} tooLarge transitions", {**req, "lDep": 80, "lArr": 80, "radius": req["radius"] * 15}, dep, arr)
    path = ROOT / "src" / "core" / "utils" / "splice" / "serviceAnswers.json"
    if args.check:
        stored = json.loads(path.read_text(encoding="utf-8"))
        problems = [f"{new['name']}: {d}" for old, new in zip(stored, cases)
                    if (d := differs(old["request"], new["request"], "request") or differs(old["answer"], new["answer"]))]
        if len(stored) != len(cases):
            problems.append(f"{len(stored)} cases stored, {len(cases)} made")
        if problems:
            print("The service answers other than src/core/utils/splice/serviceAnswers.json — splice.py changed;"
                  " follow it in src/core/utils/splice/solveSplice.js and write the file again:")
            print("\n".join(f"  {p}" for p in problems[:10]))
            sys.exit(1)
        print(f"splice answers: {len(cases)} cases as stored")
        return
    path.write_text(json.dumps(cases, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", path, len(cases), "cases,", sum("error" in c["answer"] for c in cases), "errors")


if __name__ == "__main__":
    main()
