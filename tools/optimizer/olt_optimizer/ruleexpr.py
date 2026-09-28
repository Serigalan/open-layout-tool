"""The little expression language the rule catalogues are written in
(`expression_language` in src/constraints/*.json) — the Python half of the
app's src/utils/ruleExpr.js, and meant to read like it.

Same reasons for parsing it rather than handing it to eval(): `^` is
exponentiation here and not in Python's sense of the character, `and`/`or`/
`not` short-circuit on values the catalogue may leave undefined, and a
substitution that got one case wrong would produce a number instead of an
error. A rule that silently computes the wrong limit is the one failure a
rule checker must not have — and here it would be worse than in the app: the
optimizer does not report the limit, it builds to it.

An expression is parsed once and compiled into nested closures, because the
optimizer asks for the same handful of thresholds in its innermost loop; the
syntax tree is kept as well, for `names`, which the run uses to tell which
threshold a line of `evaluation` compares against.

An unknown name raises. The catalogue names its inputs itself, so a name the
scope does not answer is a mistake in the catalogue or in the code that
builds the scope — never something to paper over.
"""

import math
import re


class ExprError(Exception):
    """An expression the language cannot read or answer."""


_KEYWORDS = {"and", "or", "not", "true", "false"}
# Longest first: `<=` must be read before `<`.
_OPERATORS = ("==", "!=", "<=", ">=", "+", "-", "*", "/", "^", "%", "<", ">")
_NUMBER = re.compile(r"[0-9]*\.?[0-9]+")
# A name may carry dots — `prev.design_speed` is one name, not a field access:
# the scope is flat and answers exactly the names the rule lists.
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")


def _tokenize(src):
    tokens = []
    i = 0
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c.isdigit() or (c == "." and src[i + 1:i + 2].isdigit()):
            m = _NUMBER.match(src, i)
            tokens.append(("number", float(m.group())))
            i = m.end()
            continue
        if c == "'":
            end = src.find("'", i + 1)
            if end < 0:
                raise ExprError(f"unterminated string in {src}")
            tokens.append(("string", src[i + 1:end]))
            i = end + 1
            continue
        if c.isalpha() or c == "_":
            m = _NAME.match(src, i)
            word = m.group()
            tokens.append((word, None) if word in _KEYWORDS else ("name", word))
            i = m.end()
            continue
        if c in "(),":
            tokens.append((c, None))
            i += 1
            continue
        op = next((o for o in _OPERATORS if src.startswith(o, i)), None)
        if op is None:
            raise ExprError(f"unexpected character {c!r} in {src}")
        tokens.append((op, None))
        i += len(op)
    tokens.append(("end", None))
    return tokens


# Binary levels from loosest to tightest. `^` is right-associative — a^b^c is
# a^(b^c) — which is the one place associativity is not left.
_BINARY_LEVELS = (("or",), ("and",), ("==", "!=", "<", "<=", ">", ">="), ("+", "-"), ("*", "/", "%"))


def _parse(tokens, src):
    at = 0

    def peek():
        return tokens[at][0]

    def take(kind):
        nonlocal at
        if tokens[at][0] != kind:
            raise ExprError(f"expected {kind}, found {tokens[at][0]} in {src}")
        at += 1

    def binary(level):
        nonlocal at
        if level >= len(_BINARY_LEVELS):
            return unary()
        left = binary(level + 1)
        while peek() in _BINARY_LEVELS[level]:
            op = tokens[at][0]
            at += 1
            left = ("binary", op, left, binary(level + 1))
        return left

    def unary():
        nonlocal at
        if peek() == "not":
            at += 1
            return ("not", unary())
        if peek() == "-":
            at += 1
            return ("negate", unary())
        return power()

    def power():
        nonlocal at
        base = primary()
        if peek() != "^":
            return base
        at += 1
        return ("binary", "^", base, unary())

    def primary():
        nonlocal at
        kind, value = tokens[at]
        if kind in ("number", "string"):
            at += 1
            return ("const", value)
        if kind in ("true", "false"):
            at += 1
            return ("const", kind == "true")
        if kind == "(":
            at += 1
            inner = binary(0)
            take(")")
            return inner
        if kind == "name":
            at += 1
            if peek() != "(":
                return ("name", value)
            at += 1
            args = []
            if peek() != ")":
                args.append(binary(0))
                while peek() == ",":
                    at += 1
                    args.append(binary(0))
            take(")")
            return ("call", value, args)
        raise ExprError(f"unexpected {kind} in {src}")

    ast = binary(0)
    take("end")
    return ast


def _number(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ExprError(f"{what} is not a number: {value!r}")
    return value


def _compare(op):
    def run(x, y):
        _number(x, f"left of {op}")
        _number(y, f"right of {op}")
        return {"<": x < y, "<=": x <= y, ">": x > y, ">=": x >= y}[op]
    return run


def _arith(op):
    def run(x, y):
        x = _number(x, f"left of {op}")
        y = _number(y, f"right of {op}")
        if op == "+":
            return x + y
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if op == "/":
            return x / y
        if op == "%":
            # JavaScript's remainder keeps the sign of the dividend; Python's
            # modulo takes the divisor's. The catalogue is written against the
            # former, so the port says so.
            return math.fmod(x, y)
        return x ** y
    return run


def _compile(node):
    """A closure (scope, fns) → value for the syntax tree `node`."""
    kind = node[0]
    if kind == "const":
        value = node[1]
        return lambda scope, fns: value
    if kind == "name":
        name = node[1]

        def lookup(scope, fns):
            try:
                return scope[name]
            except KeyError:
                raise ExprError(f"unknown name {name}") from None
        return lookup
    if kind == "not":
        inner = _compile(node[1])
        return lambda scope, fns: not inner(scope, fns)
    if kind == "negate":
        inner = _compile(node[1])
        return lambda scope, fns: -_number(inner(scope, fns), "negated value")
    if kind == "call":
        _, name, args = node
        compiled = [_compile(a) for a in args]
        # `if` picks a branch, so it is part of the language rather than one of
        # the functions: both arms may not be computed first, since one of them
        # is routinely the one that would divide by a radius that is zero on a
        # straight.
        if name == "if":
            if len(compiled) != 3:
                raise ExprError("if takes three arguments")
            cond, then, other = compiled
            return lambda scope, fns: then(scope, fns) if cond(scope, fns) else other(scope, fns)

        def call(scope, fns):
            fn = fns.get(name)
            if fn is None:
                raise ExprError(f"unknown function {name}")
            return fn(*(a(scope, fns) for a in compiled))
        return call
    if kind == "binary":
        _, op, left_node, right_node = node
        left, right = _compile(left_node), _compile(right_node)
        # Short-circuit, so `jump and r_w >= reg` may be written where r_w only
        # exists at a jump.
        if op == "and":
            return lambda scope, fns: left(scope, fns) and right(scope, fns)
        if op == "or":
            return lambda scope, fns: left(scope, fns) or right(scope, fns)
        if op == "==":
            return lambda scope, fns: left(scope, fns) == right(scope, fns)
        if op == "!=":
            return lambda scope, fns: left(scope, fns) != right(scope, fns)
        run = _compare(op) if op in ("<", "<=", ">", ">=") else _arith(op)
        return lambda scope, fns: run(left(scope, fns), right(scope, fns))
    raise ExprError(f"unknown node {kind}")


class Expr:
    """One parsed and compiled expression."""

    __slots__ = ("src", "ast", "_run")

    def __init__(self, src):
        self.src = src
        self.ast = _parse(_tokenize(src), src)
        self._run = _compile(self.ast)

    def __call__(self, scope, fns=None):
        return self._run(scope, fns or {})


# Parsing the same handful of expressions over and over adds up; the text is
# the key because it is what the catalogue holds.
_cache = {}


def parse_expr(src):
    """The compiled expression for `src`, parsed once and kept."""
    expr = _cache.get(src)
    if expr is None:
        expr = _cache[src] = Expr(src)
    return expr


def eval_expr(src, scope, fns=None):
    """Evaluate `src` over `scope` (a flat dict of names) with `fns` (the
    catalogue's functions). Raises ExprError on anything it cannot answer."""
    return parse_expr(src)(scope, fns)


def comparison(src):
    """`src` read as a single comparison `a <op> b` between two names, as
    (a, op, b) — or None where it is anything else. What a line of a rule's
    `evaluation` looks like when it compares one input against one threshold,
    which is the shape the optimizer turns into a bound."""
    node = parse_expr(src).ast
    if node[0] != "binary" or node[1] not in ("<", "<=", ">", ">="):
        return None
    left, right = node[2], node[3]
    if left[0] != "name" or right[0] != "name":
        return None
    return left[1], node[1], right[1]
