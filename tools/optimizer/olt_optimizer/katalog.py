"""A rule catalogue — DB Ril 800.0110 Linienführung as the repo holds it
(src/constraints/db-ril-800-0110.json), read and applied. The Python half of
the app's src/utils/regelkatalog.js, and meant to read like it: the same file,
the same expression language (ruleexpr.py), the same evaluation order, so the
optimizer builds to exactly the limits the app's element table judges by.

This module knows nothing about tracks. It is handed a flat scope of the
names a rule declares (`element.design_speed`, `physics.u_f`, …) and gives
back a severity, or one threshold. grenzen.py is what turns that into the
bounds a run is held to.
"""

import math

from .ruleexpr import eval_expr, parse_expr


class OutOfRange(Exception):
    """A table asked for a key it does not cover. Raised rather than returned
    so that a threshold deep inside an expression still reaches the rule,
    which answers with the table's own `out_of_range` severity — the catalogue
    says what a missing value means, and it is never "pass"."""

    def __init__(self, severity):
        super().__init__(f"out of range → {severity}")
        self.severity = severity


def _lookup_piecewise(table, key):
    """One step of a piecewise table (min_element_length): the piece's own formula."""
    for piece in table["pieces"]:
        if "key_min" in piece:
            low_ok = key >= piece["key_min"]
        elif "key_min_exclusive" in piece:
            low_ok = key > piece["key_min_exclusive"]
        else:
            low_ok = True
        high_ok = key <= piece["key_max"] if "key_max" in piece else True
        if low_ok and high_ok:
            return eval_expr(piece["expr"], {table["key"]: key})
    raise OutOfRange(table["out_of_range"])


def _resolve_from(frm, providers):
    """`physics.u0_factor` → providers["physics"]["u0_factor"]."""
    provider, _, key = frm.partition(".")
    values = providers.get(provider) or {}
    if key not in values:
        raise KeyError(f"no value for {frm}")
    return values[key]


def _lookup_speed_table(table, key, column, physics):
    """One column of a speed table (comparison_radius). A tabulated speed
    always gives the tabulated value; `key_mode` only governs what happens
    between two rows, and past the last row there is no value at all."""
    k = table["key"]
    for row in table["rows"]:
        if row[k] == key:
            return row[column]
    higher = next((row for row in table["rows"] if row[k] > key), None)
    if higher is None:
        raise OutOfRange(table["out_of_range"])
    mode = (table.get("key_mode") or {}).get(column) or {"mode": "next_higher"}
    if mode.get("mode") == "formula" and ("key_max" not in mode or key <= mode["key_max"]):
        scope = {k: key}
        for name, spec in (mode.get("inputs") or {}).items():
            scope[name] = _resolve_from(spec["from"], {"physics": physics})
        value = eval_expr(mode["expr"], scope)
        rounding = mode.get("rounding")
        return math.floor(value / rounding + 0.5) * rounding if rounding else value
    return higher[column]


class Katalog:
    """One catalogue file, loaded."""

    def __init__(self, data, physics=None):
        self.data = data
        self.id = data["catalog"]["id"]
        self.title = data["catalog"]["title"]
        self.version = data["catalog"]["katalog_version"]
        self.physics = physics or {}
        self._rank = {s["id"]: s["rank"] for s in data["severity_levels"]}
        self._rules = {rule["id"]: rule for rule in data["rules"]}
        self._fns_plain = self.functions()

    # ── reading ──────────────────────────────────────────────────────────

    def rank(self, severity):
        """Rank of a severity — higher is worse; -1 for none."""
        return self._rank.get(severity, -1)

    def rule(self, rule_id):
        rule = self._rules.get(rule_id)
        if rule is None:
            raise KeyError(f"unknown rule {rule_id}")
        return rule

    def rules_for_scope(self, scope):
        """The rules written for one kind of object: 'element', 'boundary', 'cant_ramp'."""
        return [r for r in self.data["rules"] if (r.get("applies_to") or {}).get("scope") == scope]

    def rules_for_element(self, type_id, form_id=None):
        """The element rules that speak about this kind of element. A rule
        without `element_types` speaks about all of them; one that names
        `forms` speaks only about a transition curve of that form."""
        out = []
        for rule in self.rules_for_scope("element"):
            applies = rule["applies_to"]
            if "element_types" in applies and type_id not in applies["element_types"]:
                continue
            if "forms" in applies and not (form_id and form_id in applies["forms"]):
                continue
            out.append(rule)
        return out

    # ── applying ─────────────────────────────────────────────────────────

    def functions(self, in_context=None):
        """The functions the catalogue's expressions may call. `if` is not
        among them — the language evaluates it itself so that only the chosen
        branch is computed (see ruleexpr.py)."""
        physics = self.physics
        tables = self.data.get("tables") or {}

        def lookup(table_id, key, column=None):
            table = tables.get(table_id)
            if table is None:
                raise KeyError(f"unknown table {table_id}")
            if table["type"] == "piecewise":
                return _lookup_piecewise(table, key)
            return _lookup_speed_table(table, key, column, physics)

        return {
            "min": min,
            "max": max,
            "abs": abs,
            # Half a step rounds up, as the catalogue states (and as the app's
            # Math.round does) — not Python's round-half-to-even.
            "round_to": lambda x, step: math.floor(x / step + 0.5) * step,
            "lookup": lookup,
            "in_context": (lambda cid: bool(in_context and in_context(cid))),
        }

    def _fns(self, in_context):
        return self._fns_plain if in_context is None else self.functions(in_context)

    def _inputs(self, rule, base, fns):
        scope = dict(base)
        for name, spec in (rule.get("inputs") or {}).items():
            if "expr" in spec:
                scope[name] = parse_expr(spec["expr"])(scope, fns)
            else:
                frm = spec["from"]
                if frm not in scope:
                    raise KeyError(f"{rule['id']}: nothing provides {frm} for {name}")
                scope[name] = scope[frm]
        return scope

    def evaluate_rule(self, rule, base, in_context=None):
        """Apply one rule to one object: inputs, then the condition, then the
        thresholds in the order the file lists them (a later one may use an
        earlier), then the first matching line of `evaluation`.

        Returns {id, applied, severity, values}; `applied: False` means the
        rule does not speak about this object, which is not the same as `ok`.
        """
        fns = self._fns(in_context)
        scope = self._inputs(rule, base, fns)
        try:
            if "condition" in rule and not parse_expr(rule["condition"])(scope, fns):
                return {"id": rule["id"], "applied": False, "severity": None, "values": scope}
            for name, spec in (rule.get("thresholds") or {}).items():
                scope[name] = parse_expr(spec["expr"])(scope, fns)
            for entry in rule["evaluation"]:
                if "else" in entry:
                    return {"id": rule["id"], "applied": True, "severity": entry["else"], "values": scope}
                if parse_expr(entry["if"])(scope, fns):
                    return {"id": rule["id"], "applied": True, "severity": entry["severity"],
                            "values": scope}
        except OutOfRange as exc:
            return {"id": rule["id"], "applied": True, "severity": exc.severity,
                    "values": scope, "out_of_range": True}
        # A catalogue whose last line is not an `else` leaves a case unanswered.
        raise ValueError(f"{rule['id']}: no branch of evaluation matched")

    def threshold(self, rule, name, base, in_context=None):
        """One threshold of one rule for one object — the number the checker
        would really compare against. None where the rule does not speak about
        the object (its condition is false); OutOfRange propagates, so the
        caller decides what a missing value means for it.

        Stops at `name`: the optimizer asks for one bound in its innermost
        loop, and the thresholds after it are not needed to compute it."""
        fns = self._fns(in_context)
        scope = self._inputs(rule, base, fns)
        if "condition" in rule and not parse_expr(rule["condition"])(scope, fns):
            return None
        for key, spec in rule["thresholds"].items():
            scope[key] = parse_expr(spec["expr"])(scope, fns)
            if key == name:
                return scope[key]
        raise KeyError(f"{rule['id']} has no threshold {name}")
