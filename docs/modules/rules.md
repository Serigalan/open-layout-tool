# rules — the rule catalogue and the alignment checks

`src/core/utils/rules/` · needs `geometry`

DB Ril 800.0110 (Linienführung) is held in the repository as a **rule catalogue** —
`src/core/constraints/db-ril-800-0110.json` — written in a small expression language. This module parses
and applies it: it evaluates rules on a flat scope of named inputs, fills that scope from the app's element
chains, derives the limits the dialogs need (cant, cant deficiency, speed, element and transition lengths)
by asking the rules rather than restating their numbers, and builds the tables the rulebook viewers show.
The vertical (Höhenplan) half of the catalogue is applied in `elevation/gradientCheck.js`.

## Files

| File | What it does |
|---|---|
| `ruleExpr.js` | Tokenizer, parser and evaluator of the catalogue's expression language |
| `regelkatalog.js` | Reads the catalogue: severities, rules by scope, tables, `evaluateRules`, `catalogLimit` (a rule's threshold as a number) |
| `trassierungCheck.js` | Fills the rule scope from an element chain and checks a track: per element, per boundary, per cant ramp (`checkTrack`, `hasRuleError`) |
| `cant.js` | Cant and cant deficiency: limits (LP.KB.01/02/05/06), the 5 mm step, Regelüberhöhung, the cant a dialog proposes, the speed a curve permits |
| `speed.js` | The radius and cant that govern an element's physics; every element's speed raised to what its geometry admits |
| `elementLength.js` | `l_min` of LP.EL.01 and the comparison radius of LP.KS.01 (Regelwert, Ermessensgrenze) at a speed |
| `transitionLength.js` | Regellänge and Mindestlänge of a transition, found from the length rules; the formula each rule shows |
| `regelwerkDefaults.js` | The few values the dialogs need synchronously, read from the catalogue |
| `ruleFields.js` | Which form field a finding belongs to |
| `constraintsView.js` | The physics file and the optimizer's limits as table rows for the viewers |
| `catalogHash.js` | SHA-256 over the bundled catalogue files, compared with the optimizer service's |

## The catalogue

The catalogue is data, not a description of code. Its parts:

- **`severity_levels`**, ranked: `ok` 0, `hint` 1 (recommendation not followed), `warning` 2 (below the
  Regelwert, within the Ermessensgrenze — must be justified), `approval` 3 (below the Ermessensgrenze, within
  the Zustimmungswert — needs approval), `special_case` 4 (outside the guideline; for experienced designers),
  `error` 5 (limit violated).
- **`rules`**, each with an id (LP.* Lageplan, HP.* Höhenplan), `applies_to.scope` (`element`, `boundary`,
  `cant_ramp`, `gradient`, `vertical_curve`), `inputs` (named values and where they come from:
  `element.design_speed`, `physics.u_f`, `prev.…`, `next.…`), `thresholds` (named expressions:
  `reg`, `discretion`, …), an ordered `evaluation` (the first `if` that holds sets the severity, `else`
  always holds) and an optional `condition` (false → not applicable).
- **`tables`** (piecewise formulas, speed tables) read by `lookup` functions; a key outside a table gives the
  table's `out_of_range` severity — never "pass".
- **`aggregation`**: every rule gives one severity; an object's result is the worst. Where several limits
  apply (in general and in a turnout area), they are separate rules, so the strictest wins by itself.

The rules: LP.ALL.01–02 (design speed 40–300 km/h, 5 km/h steps), LP.EL.01–02 (minimum element length,
intermediate straight between reverse curves at 40 km/h), LP.KB.01–06 (cant, cant deficiency, 5 mm steps,
deviation from the Regelüberhöhung, cant and deficiency in turnout areas), LP.UB.01–09 (continuous cant,
ramp coinciding with the transition, minimum transition lengths from the ramp and from the change of
deficiency for clothoid and Bloss, steepest and flattest mean ramp, clothoid as standard form), LP.KS.01–02
(comparison radius at a curvature jump, jumps outside turnouts), HP.LN.01–03 (gradients), HP.AR.01–07
(vertical curves).

The same file is read by the optimizer service (`tools/optimizer`, through a symlink), which evaluates it
with its own port of the expression language. Shared test vectors in `src/core/constraints/tests/` hold the
two implementations to the same answers (`ruleExpr.vectors.test.js`, `trassierungCheck.vectors.test.js`,
`transitionLength.vectors.test.js` against `tools/optimizer/tests/vectors.py`).

## The expression language

Number-value equations over named inputs with `+ - * / ^ %`, comparisons, `and or not`, `min max abs
round_to if` and the catalogue's `lookup` functions. Names may contain dots (`prev.design_speed` is one
name — the scope is flat). An unknown name throws.

It is **parsed, not translated into JavaScript**: `^` is exclusive-or in JavaScript and power here, `and`,
`or`, `not` are no JavaScript operators, and a string substitution that gets one case wrong produces a
number rather than an error. A rule that silently computes a wrong limit is the one failure a rule checker
must not have. `if(c, a, b)` is evaluated lazily, so only the chosen branch is computed.

## Checking a track

`checkTrack(elements)` (`trassierungCheck.js`) fills the scope for each element, each boundary between two
elements and each cant ramp, evaluates every rule of that scope and returns the findings per element and per
boundary. The scope is built from the app's own arithmetic — the deficiency from `cant.js`, the ramp ends
from `transitionCantEnds` — never re-derived: a checker with its own physics would first of all find its own
disagreement with the layout.

- An element without a design speed (`speed` 0 or missing, as from imports) is **not checked**: an unknown
  speed is not a slow one, and judging it as 39 km/h would produce a page of errors about a number nobody
  entered.
- At a boundary and for rules over several elements the larger speed of the elements involved counts.
- LP.EL.01 reads an element's length as the **run of its own curvature**: straights next to each other, or
  arcs of one radius, are one element on the ground (a straight split at a switch end, the straight end
  piece of a turnout's branch running on into the connecting straight), whatever cant each carries — two
  straights with ramps of their own stay two elements and are one straight to the rule. Transitions stand
  alone. The Python port (`pruefung.py`) does the same (Entscheidung 356).
- A check of **part of a track** — what a dialog is about to write — is given what lies beside it:
  `checkTrack(chain, { context: [before, after] })` (and `hasRuleError`, `RuleFindings`, `check_track(...,
  context=)`) lets a run reaching the chain's end go on into it. `runBeside(elements, i, side)` reads the
  run of an element's curvature beside it, `endRun(elements)` the one a track ends in. Splicing,
  reconnecting, "Gerade/Bogen anschließen" and the pieces a turnout leaves of its element all use it, so
  every dialog reads LP.EL.01 as the track check does (Entscheidung 363).
- Cant is stored signed with the curve; the rules read its magnitude. Over a reverse transition the cross
  level really travels from one rail to the other, so the ramp height and the change of deficiency are
  **signed sums**, not differences of magnitudes (a too-short reverse clothoid passed before).
- A transition's cant ramp is always straight in this model (cant lives at element ends and is interpolated
  linearly), so it matches a clothoid and not a Bloss curve; LP.UB.02 reports a Bloss curve as a special
  case, which is a true statement about the model.

**What blocks a dialog.** Every create and connect dialog asks `hasRuleError` on the elements it would write,
and **only an error blocks** — `special_case` and hints do not; an element without speed is not judged. That
holds even where the geometry forces a too-short element: "built to the rulebook" means nothing otherwise.

## Cant and speed

With `v` in km/h, `R` in m, cant `u` in mm:

```
equilibrium cant       u_eq = 11.8 · v² / R          (11.8 = 1000·1.5 / (3.6²·9.81), physics.json)
cant deficiency        u_f  = 11.8 · v² / R − u
Regelüberhöhung        u_reg = 6.5 · v² / R          on the 5 mm step, capped (LP.KB.04)
permitted speed        v = √( R·(u + u_f,max) / 11.8 )
```

Limits are read from the rules with `catalogLimit(ruleId, threshold, scope)`:

- cant on plain track 160 mm (LP.KB.01), in 5 mm steps (LP.KB.03);
- cant deficiency 130 mm, above 150 km/h up to 150 mm at the Ermessensgrenze (LP.KB.02) — one limit per
  speed; the dialogs refuse past the Ermessensgrenze;
- in a turnout 100 mm cant, up to 120 mm with a **written justification** on the element
  (`cantException`) — a text, not a checkbox, because an exception nobody had to write down can be clicked
  away; it is shown on the plan and warned about in the element table (LP.KB.05); deficiency per LP.KB.06.

The cant a dialog proposes (`computeAutoC`) is the Regelüberhöhung, except that a curve whose deficiency
without any cant stays under 60 mm gets none. The optimizer service proposes the same (`AUTO_CANT_MODEL`).
Even the step where the deficiency limit changes is found by asking the rule speed by speed, so a Ril with a
third step would need no change here.

`maxSpeeds` raises each element's speed to what its geometry admits: a curve (an arc, or a transition at its
tighter end with the neighbour's cant there) to the speed its radius and cant permit, rounded down to 5
km/h; a straight to the faster of the curves either side; capped by the line speed.

## Transition lengths

The **Regellänge** of a transition is the shortest length at which every length rule (LP.EL.01, LP.UB.03–07)
holds its Regelwert; the **Mindestlänge** the shortest at which each holds its Ermessensgrenze (or its
Regelwert where it has none) — shorter needs approval or is an error. Both are found by searching the
catalogue on the chain `[previous element, transition, next element]`, rounded up to 0.1 m
(`transitionLengths`). The dialogs show the governing rule with its formula, e.g. LP.UB.07, whose steepest
mean ramp 1:600 (Regelwert) / 1:400 (Ermessensgrenze) applies to a Bloss curve at 2/3 of its middle slope —
the catalogue writes the threshold as `600 * if(form == 'bloss', 3 / 2, 1)`, so check, Regel- and
Mindestlänge follow without code of their own. LP.UB.08 (flattest ramp) bounds from above and is left to the
check.

## Decisions

- **The catalogue is the rule.** No limit, step or formula in code; a value copied into code would no longer
  be maintained where the rulebook is.
- **Parsed expressions**, unknown names throw.
- **Rule values are read from rules** (`catalogLimit`) — the dialogs create to the rulebook, not beside it.
- **Only errors block**; warnings require justification, approvals are flagged, special cases are allowed.
  An error blocks the plain Commit, not the user: "trotzdem übernehmen" commits it anyway (Entscheidung 361).
- **Speedless elements are not judged.**
- **The rulebooks are edited in the repository, not in the app.** The service is shared; a write path would
  change limits for everyone, and browser-only values would be numbers no drift check reads.
- **Same catalogue in browser and service**, checked by hash (`catalogHash.js`): when the service runs on
  other rules than the app shows, the panels say so.

## Tests

`ruleExpr.test.js`, `regelkatalog.test.js`, `trassierungCheck.test.js`, `cant.test.js`, `speed.test.js`,
`transitionLength.test.js`, the three `*.vectors.test.js`, `regelwerkDefaults.test.js` (no copy of the
catalogue beside the optimizer), `catalogHash.test.js` (same hash as the service computes).
