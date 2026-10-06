"""The limits a run is held to, read out of the rule catalogue for one level.

A run is asked for a *Stufe*: the Regelwert (`reg`) or the Ermessensgrenze
(`discretion`). What that means is not a table of numbers kept here — it is a
severity. Under the Regelwert nothing the run proposes may be judged worse
than a hint; under the Ermessensgrenze nothing worse than a warning. Which
threshold of a rule that comes down to is read off the rule's own `evaluation`:
the last line whose severity is still admitted is the line that bounds the
run, and the threshold it compares against is the bound. LP.UB.03 under the
Regelwert is `l_R >= reg`, i.e. 10·v·Δu/1000; under the Ermessensgrenze
`l_R >= discretion`, i.e. 8·v·Δu/1000. A rule whose admitted lines run into an
`else` never binds the run at all — a hint, at either level.

What the bound then *is* for the geometry is the one piece of model knowledge
here, and it is read from where the rule takes its input from, the way the
app's trassierungCheck.js fills the same names:

  element.length     a lower (or upper) bound on an element's length
  physics.ramp_slope the mean ramp gradient 1:m, turned into a length by
                     l = m·Δu/1000 (derived_inputs in the catalogue)
  element.cant       the cants a curve may carry
  physics.u_f        the cant deficiency, and with it the speed of a curve
  physics.r_w        the comparison radius at a curvature jump
  element.design_speed alone
                     the design speeds that exist at all (40…300 in 5 km/h)

A rule this module cannot place in one of those is refused when the limits
are built, not skipped: a run that quietly ignored a rule of the catalogue it
names would be the one thing this file exists to prevent.

The existing alignment is a fact, not a proposal: the length rules are not
applied to it (see optimize.evaluate_group). The speed rules are — what speed a
geometry permits is a question the catalogue answers for the existing curve
as much as for a new one.
"""

import bisect
import functools
import math

from .geometry import CANT_DEFICIENCY_COEFF, permissible_speed
from .katalog import OutOfRange
from .ruleexpr import comparison

# The worst severity a run may produce, by the level it was asked for.
STUFEN = {"reg": "hint", "discretion": "warning"}
DEFAULT_STUFE = "reg"

# The rule scopes a level lets a run past whatever they say. At the
# Ermessensgrenze that is the cant ramp (LP.UB.02): it judges the ramp's *form*
# against the transition's, and in this app every ramp is straight (ROADMAP,
# decision 47), so a Bloss transition is a Sonderfall there by the app's model,
# not by a limit of the Ril. The client decided (ROADMAP, decision 57) that a
# run at the Ermessensgrenze still proposes Bloss transitions — their lengths
# and gradients are held to LP.UB.04/06/07/08 like any other — and the element
# table then shows each one as the Sonderfall it is.
TOLERIERT = {"reg": (), "discretion": ("cant_ramp",)}

# The scopes of the Höhenplan — the stretch between two height points and the
# gradient change at one. They judge the gradient, which no optimizer run
# touches.
VERTICAL_SCOPES = ("gradient", "vertical_curve")

_FLIP = {"<": ">", "<=": ">=", ">": "<", ">=": "<="}
_LOWER = (">", ">=")

# What a design speed or a cant is scanned over when the catalogue is asked
# which of them it admits. Wide on purpose: the catalogue says where its own
# range ends, this only has to reach past it.
_SPEED_SCAN = range(1, 1001)
_CANT_SCAN = [i / 2 for i in range(0, 2001)]          # 0 … 1000 mm in 0.5 mm

# The names a rule may take its input from, and what they are to a run.
_SPEED_ONLY = {"element.design_speed"}
_CANT_ONLY = {"element.cant"}
_CONTINUITY = {"prev.cant_end", "next.cant_start"}


class GrenzenError(Exception):
    """A level that does not exist, or a rule a run cannot be held to."""


def _froms(rule):
    """The model names a rule reads its inputs from — enough to tell what kind
    of object it judges and what it bounds."""
    names = set()
    for spec in (rule.get("inputs") or {}).values():
        if "from" in spec:
            names.add(spec["from"])
    return names


class Grenzen:
    """The limits of one catalogue at one level, ready for the optimizer."""

    def __init__(self, katalog, stufe=DEFAULT_STUFE):
        if stufe not in STUFEN:
            raise GrenzenError(f"unbekannte Grenzwertstufe: {stufe}")
        self.katalog = katalog
        self.stufe = stufe
        self.regelwerk = katalog.id
        self.max_rank = katalog.rank(STUFEN[stufe])
        # Rules a run at this level is let past (TOLERIERT), by id — what the
        # acceptance's own check has to know to judge a run fairly.
        self.toleriert = {r["id"] for scope in TOLERIERT[stufe] for r in katalog.rules_for_scope(scope)}

        self.speeds = self._design_speeds()
        if not self.speeds:
            raise GrenzenError(f"{katalog.id}: der Katalog lässt keine Entwurfsgeschwindigkeit zu")
        self.v_top = self.speeds[-1]
        self._speed_index = {V: i for i, V in enumerate(self.speeds)}

        # The cants a curve may carry, on the line and in a turnout.
        self._cants = {sw: self._cant_grid(sw) for sw in (False, True)}
        self.u_step = self._cants[False][1] - self._cants[False][0]
        for sw, grid in self._cants.items():
            if any(abs((b - a) - self.u_step) > 1e-9 for a, b in zip(grid, grid[1:])):
                raise GrenzenError(f"{katalog.id}: das Überhöhungsraster ist nicht gleichmäßig")

        self._element_bounds = {}          # (type, form) → [(rule, op, thr, kind)]
        self._jump_rules = []              # [(rule, op, thr)]
        self._ramp_rules = []              # cant_ramp scope
        self._classify()

        # Per design speed, once: everything that depends on nothing else.
        self._uf = {(V, sw): self._deficiency_bound(V, sw) for V in self.speeds for sw in (False, True)}
        self._uf_levels = {sw: sorted({self._uf[(V, sw)] for V in self.speeds}, reverse=True)
                           for sw in (False, True)}
        self._min_len = {}
        self._rw_min = {internal: [self._jump_bound(V, internal) for V in self.speeds]
                        for internal in (False, True)}
        self.forms = {form: self._form_admitted(form) for form in ("clothoid", "bloss")}

    # ── building ─────────────────────────────────────────────────────────

    def _admits(self, severity):
        return severity is not None and self.katalog.rank(severity) <= self.max_rank

    def _all_admit(self, rules, base, in_context=None):
        for rule in rules:
            res = self.katalog.evaluate_rule(rule, base, in_context)
            if res["applied"] and not self._admits(res["severity"]):
                return False
        return True

    def _design_speeds(self):
        """The design speeds the catalogue admits at all — asked of the rules
        that read nothing but the speed (LP.ALL.01/02), not read out of their
        text, the same way the app's catalogSpeedRange finds them."""
        rules = [r for r in self.katalog.rules_for_scope("element") if _froms(r) == _SPEED_ONLY]
        return [float(v) for v in _SPEED_SCAN
                if self._all_admit(rules, {"element.design_speed": float(v)})]

    def _cant_grid(self, on_switch):
        """The cants a curve may carry — asked of the rules that read nothing
        but the cant (LP.KB.01, LP.KB.03 and, in a turnout, LP.KB.05)."""
        rules = [r for r in self.katalog.rules_for_element("circular_arc") if _froms(r) == _CANT_ONLY]
        ctx = (lambda cid: cid == "switch_area") if on_switch else None
        grid = [u for u in _CANT_SCAN if self._all_admit(rules, {"element.cant": u}, ctx)]
        if not grid or grid[0] != 0.0 or len(grid) < 2:
            raise GrenzenError(f"{self.katalog.id}: kein Überhöhungsraster ab 0 mm")
        return grid

    def _bound(self, rule):
        """Which line of `evaluation` bounds a run at this level, as
        (input, op, threshold) with the input on the left — or None where the
        rule admits every case (it never binds), or "complex" where the
        bounding line is not one comparison of an input against a threshold."""
        admitted = None
        for entry in rule["evaluation"]:
            severity = entry.get("severity", entry.get("else"))
            if not self._admits(severity):
                break
            if "else" in entry:
                return None
            admitted = entry
        else:
            return None
        if admitted is None:
            return "complex"
        cmp = comparison(admitted["if"])
        if cmp is None:
            return "complex"
        a, op, b = cmp
        inputs, thresholds = rule.get("inputs") or {}, rule.get("thresholds") or {}
        if a in inputs and b in thresholds:
            return a, op, b
        if b in inputs and a in thresholds:
            return b, _FLIP[op], a
        return "complex"

    def _refuse(self, rule, why):
        raise GrenzenError(f"{rule['id']} ({rule.get('title', '')}): {why} — "
                           "der Optimierer kann diese Regel nicht einhalten")

    def _classify(self):
        k = self.katalog
        types = {"straight": [None], "circular_arc": [None], "transition_curve": ["clothoid", "bloss"]}
        for etype, forms in types.items():
            for form in forms:
                bounds = []
                for rule in k.rules_for_element(etype, form):
                    froms = _froms(rule)
                    if froms == _SPEED_ONLY or froms == _CANT_ONLY:
                        continue              # the speed and cant grids above
                    bound = self._bound(rule)
                    if bound is None:
                        continue
                    if bound == "complex":
                        self._refuse(rule, "die maßgebende Zeile ist kein einfacher Vergleich")
                    inp, op, thr = bound
                    what = (rule["inputs"][inp].get("from"))
                    if what == "element.length":
                        kind = "length"
                    elif what == "physics.ramp_slope" and etype == "transition_curve":
                        kind = "slope"
                    elif what == "physics.u_f" and etype == "circular_arc" and op not in _LOWER:
                        kind = "deficiency"
                    else:
                        self._refuse(rule, f"begrenzt {what}")
                    bounds.append((rule, op, thr, kind))
                self._element_bounds[(etype, form)] = bounds

        for rule in k.rules_for_scope("boundary"):
            bound = self._bound(rule)
            if bound is None:
                continue
            if bound == "complex":
                # A cant that jumps at a joint: every ramp the run hands out
                # starts and ends on the cant of its neighbours, by
                # construction (optimize.ramp_lengths).
                if _froms(rule) <= _CONTINUITY:
                    continue
                self._refuse(rule, "die maßgebende Zeile ist kein einfacher Vergleich")
            inp, op, thr = bound
            if rule["inputs"][inp].get("from") != "physics.r_w" or op not in _LOWER:
                self._refuse(rule, f"begrenzt {rule['inputs'][inp].get('from')}")
            self._jump_rules.append((rule, op, thr))

        self._ramp_rules = k.rules_for_scope("cant_ramp")
        for scope in {(r.get("applies_to") or {}).get("scope") for r in k.data["rules"]}:
            # The vertical alignment (HP) is not something a run builds: it
            # rearranges the plan view and leaves the heights to the profile.
            if scope in VERTICAL_SCOPES:
                continue
            if scope not in ("element", "boundary", "cant_ramp"):
                raise GrenzenError(f"{k.id}: Regeln für '{scope}' kennt der Optimierer nicht")

    @staticmethod
    def _base(V, **kw):
        """The flat scope an element rule reads, as the app's elementScope
        fills it. Only what the run is asking about is set; the rest are the
        values of an element that has none of it."""
        base = {
            "element.design_speed": V, "element.length": 0.0, "element.cant": 0.0,
            "element.radius": 0.0, "element.transition_form": "",
            "prev.design_speed": V, "next.design_speed": V,
            "physics.u_f": 0.0, "physics.delta_u": 0.0, "physics.delta_u_f": 0.0,
            "physics.ramp_slope": 0.0, "model.reverse_curve_straight": False,
        }
        base.update(kw)
        return base

    def _deficiency_bound(self, V, on_switch):
        ctx = (lambda cid: cid == "switch_area") if on_switch else None
        limit = math.inf
        for rule, op, thr, kind in self._element_bounds[("circular_arc", None)]:
            if kind != "deficiency":
                continue
            value = self.katalog.threshold(rule, thr, self._base(V), ctx)
            if value is not None:
                limit = min(limit, value)
        if not math.isfinite(limit):
            raise GrenzenError(f"{self.katalog.id}: kein Überhöhungsfehlbetrag bei {V:g} km/h")
        return limit

    def _jump_bound(self, V, internal):
        """The smallest comparison radius a curvature jump may have at V."""
        base = {"prev.design_speed": V, "next.design_speed": V,
                "physics.curvature_jump": True, "physics.r_w": 0.0,
                "prev.cant_end": 0.0, "next.cant_start": 0.0}
        need = 0.0
        for rule, op, thr in self._jump_rules:
            if internal and "switch_internal" in ((rule.get("applies_to") or {}).get("excludes") or []):
                continue
            try:
                value = self.katalog.threshold(rule, thr, base)
            except OutOfRange:
                return math.inf               # no value in the table: no jump admitted
            if value is not None:
                need = max(need, value)
        return need

    def _form_admitted(self, form):
        """May a run hand out a transition of this form? LP.UB.02 asks
        whether the ramp matches it, and in this app the ramp is always
        straight (ROADMAP, decision 47) — so it matches a clothoid only. At
        the Ermessensgrenze that question is let past (TOLERIERT)."""
        base = {"model.ramp_on_transition": True, "model.ramp_form_matches": form == "clothoid"}
        rules = [r for r in self._ramp_rules if r["id"] not in self.toleriert]
        return self._all_admit(rules, base)

    # ── asking ───────────────────────────────────────────────────────────

    def design_speed(self, v):
        """The design speed a run states for a curve that permits v: the
        fastest one the catalogue admits that is not above it. None below the
        slowest — the catalogue has nothing to say about such a curve."""
        i = bisect.bisect_right(self.speeds, v + 1e-9)
        return self.speeds[i - 1] if i else None

    def u_max(self, on_switch=False):
        return self._cants[bool(on_switch)][-1]

    def uf_max(self, V, on_switch=False):
        """The cant deficiency admitted at design speed V."""
        return self._uf[(V, bool(on_switch))]

    def speed(self, radius, cant, on_switch=False):
        """The speed [km/h] a curve of this radius and cant permits.

        Continuous, as the kernel works with it — but the deficiency it is
        computed with is the one admitted at the design speed that answer
        would be stated at. LP.KB.02 is a step (130 mm, and above 150 km/h up
        to 150 mm at the Ermessensgrenze), so each level of the step is tried
        from the most generous down, and taken where its own speed lands in
        the range it holds for — the same question the app's maxSpeedFor asks.
        """
        levels = self._uf_levels[bool(on_switch)]
        for level in levels:
            v = permissible_speed(radius, cant, level)
            V = self.design_speed(v)
            if V is not None and self._uf[(V, bool(on_switch))] >= level - 1e-9:
                return v
        return permissible_speed(radius, cant, levels[-1])

    def radius_for(self, v, cant, on_switch=False):
        """The radius at which a curve with this cant reaches v."""
        V = self.design_speed(v) or self.speeds[0]
        return v * v * CANT_DEFICIENCY_COEFF / (cant + self.uf_max(V, on_switch))

    def jump_speed(self, r_w, v, internal=False):
        """The speed a curvature jump with comparison radius r_w leaves a
        curve running at v: v itself where the jump passes at v's design
        speed, else the fastest design speed below at which it does — and None
        where it passes at none (LP.KS.01)."""
        V = self.design_speed(v)
        if V is None:
            return None
        table = self._rw_min[bool(internal)]
        i = self._speed_index[V]
        if table[i] <= r_w:
            return v
        while i >= 0 and table[i] > r_w:
            i -= 1
        return self.speeds[i] if i >= 0 else None

    def jump_need(self, V, internal=False):
        """The comparison radius a curvature jump needs at design speed V."""
        return self._rw_min[bool(internal)][self._speed_index[V]]

    def min_length(self, etype, V, reverse=False):
        """The shortest element of this type the catalogue admits at V
        (LP.EL.01; for a straight between reverse curves also LP.EL.02)."""
        key = (etype, V, reverse)
        if key not in self._min_len:
            base = self._base(V, **{"model.reverse_curve_straight": reverse})
            need = 0.0
            for rule, op, thr, kind in self._element_bounds[(etype, None if etype != "transition_curve" else "clothoid")]:
                if kind != "length" or op not in _LOWER:
                    continue
                if _froms(rule) - {"element.design_speed", "element.length", "prev.design_speed",
                                   "next.design_speed", "model.reverse_curve_straight"}:
                    continue                  # depends on more than the speed: not a floor
                value = self.katalog.threshold(rule, thr, base)
                if value is not None:
                    need = max(need, value)
            self._min_len[key] = need
        return self._min_len[key]

    def ramp_bounds(self, form, V, delta_u, delta_uf):
        """(shortest, longest) a transition of this form may be at design
        speed V, carrying a cant step delta_u and a deficiency step delta_uf
        [mm] — every length and gradient rule of the form at once (LP.EL.01,
        LP.UB.03…08), together with the rule that asked for the shortest.
        None where a rule admits no length at all."""
        base = self._base(V, **{"element.transition_form": form,
                                "physics.delta_u": delta_u, "physics.delta_u_f": delta_uf})
        lo, hi, by = 0.0, math.inf, None
        for rule, op, thr, kind in self._element_bounds[("transition_curve", form)]:
            try:
                value = self.katalog.threshold(rule, thr, base)
            except OutOfRange:
                return None
            if value is None:
                continue
            length = value if kind == "length" else value * delta_u / 1000.0
            if op in _LOWER:
                if length > lo:
                    lo, by = length, rule["id"]
            else:
                hi = min(hi, length)
        return lo, hi, by

    def describe(self):
        """What the service says a run at this level is held to — the numbers
        that do not depend on a curve, for GET /regelwerke/<id>."""
        return {
            "stufe": self.stufe,
            "schlechtesteStufe": STUFEN[self.stufe],
            "geschwindigkeiten": [self.speeds[0], self.v_top],
            "uMax": self.u_max(False), "uMaxWeiche": self.u_max(True), "uStep": self.u_step,
            "ufMax": sorted({self._uf[(V, False)] for V in self.speeds}),
            "ufMaxWeiche": sorted({self._uf[(V, True)] for V in self.speeds}),
            "uebergangsbogen": [form for form, ok in self.forms.items() if ok],
        }


@functools.lru_cache(maxsize=None)
def grenzen_for(regelwerk_id, stufe):
    """The limits for one catalogue and level, built once per process."""
    from .regelwerk import load_katalog
    return Grenzen(load_katalog(regelwerk_id), stufe)
