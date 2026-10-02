"""The shared test vectors (src/constraints/tests/) against the Python side.

The app (ruleExpr.js, trassierungCheck.js) and this package (ruleexpr.py,
tests/katalog_check.py) implement the same expression language and the same
catalogue check twice. The vectors are one set of cases both have to answer
alike; the app's half is src/utils/ruleExpr.vectors.test.js and
src/utils/trassierungCheck.vectors.test.js.

    python tests/vectors.py        (exit code 1 on the first difference)
"""

import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from olt_optimizer.regelwerk import CONSTRAINTS_DIR, load_katalog  # noqa: E402
from olt_optimizer.ruleexpr import ExprError, eval_expr            # noqa: E402
from katalog_check import check_track                              # noqa: E402

VECTORS = CONSTRAINTS_DIR / "tests"

FNS = {
    "min": min,
    "max": max,
    "abs": abs,
    "round_to": lambda x, step: math.floor(x / step + 0.5) * step,
}

failures = []


def expressions():
    data = json.loads((VECTORS / "expressions.json").read_text(encoding="utf-8"))
    for case in data["cases"]:
        src, scope = case["src"], case.get("scope", {})
        try:
            got = eval_expr(src, scope, FNS)
        except ExprError:
            got = "<error>"
        want = "<error>" if case.get("error") else case["value"]
        same = got == want if not isinstance(want, float) else (
            isinstance(got, (int, float)) and abs(got - want) <= 1e-9 * max(1, abs(want)))
        if isinstance(want, bool) or isinstance(got, bool):
            same = type(got) is type(want) and got == want
        if not same:
            failures.append(f"expression {src!r}: want {want!r}, got {got!r}")
    return len(data["cases"])


def checks():
    data = json.loads((VECTORS / "checks.json").read_text(encoding="utf-8"))
    katalog = load_katalog(data["catalogue"])
    for chain in data["chains"]:
        got = sorted([list(f) for f in check_track(katalog, chain["elements"])],
                     key=lambda f: json.dumps(f, separators=(",", ":"), ensure_ascii=False))
        want = sorted(chain["findings"], key=lambda f: json.dumps(f, separators=(",", ":"), ensure_ascii=False))
        if got != want:
            missing = [f for f in want if f not in got]
            extra = [f for f in got if f not in want]
            failures.append(f"chain {chain['name']!r}: missing {missing[:5]}, extra {extra[:5]}")
    return len(data["chains"])


if __name__ == "__main__":
    n_expr = expressions()
    n_chain = checks()
    for f in failures:
        print("FAIL", f)
    print(f"{n_expr} expressions, {n_chain} chains: {'ok' if not failures else f'{len(failures)} failing'}")
    sys.exit(1 if failures else 0)
