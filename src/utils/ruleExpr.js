/**
 * The little expression language the rule catalogue is written in
 * (`expression_language` in src/regelkataloge/*.json): number-value equations
 * over named inputs, with the operators and functions the catalogue lists and
 * nothing else.
 *
 * It is parsed rather than translated into JavaScript and handed to
 * `new Function`. Three of its operators do not mean in JavaScript what they
 * mean here — `^` is exclusive-or there and exponentiation here, `and`/`or`/
 * `not` are not operators there at all — so a translation would be a rewrite
 * of every expression by string substitution, and a substitution that gets one
 * case wrong (a `not` inside a string, an identifier containing `or`) produces
 * a number rather than an error. A rule that silently computes the wrong limit
 * is the one failure mode a rule checker must not have.
 *
 * An unknown name throws. The catalogue names its inputs itself, so a name the
 * scope does not answer is a mistake in the catalogue or in the code that
 * builds the scope — never something to paper over with undefined.
 */

class ExprError extends Error {}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false'])
// Longest first: `<=` must be read before `<`.
const OPERATORS = ['==', '!=', '<=', '>=', '+', '-', '*', '/', '^', '%', '<', '>']

function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))
      tokens.push({ type: 'number', value: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) throw new ExprError(`unterminated string in ${src}`)
      tokens.push({ type: 'string', value: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    // A name may carry dots — `prev.design_speed` is one name, not a field
    // access: the scope is flat and answers exactly the names the rule lists.
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))
      tokens.push(KEYWORDS.has(m[0]) ? { type: m[0] } : { type: 'name', value: m[0] })
      i += m[0].length
      continue
    }
    if (c === '(' || c === ')' || c === ',') { tokens.push({ type: c }); i++; continue }
    const op = OPERATORS.find(o => src.startsWith(o, i))
    if (!op) throw new ExprError(`unexpected character ${JSON.stringify(c)} in ${src}`)
    tokens.push({ type: op })
    i += op.length
    continue
  }
  tokens.push({ type: 'end' })
  return tokens
}

// Binary levels from loosest to tightest. `^` is right-associative — a^b^c is
// a^(b^c) — which is the one place associativity is not left.
const BINARY_LEVELS = [
  ['or'], ['and'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%'],
]
const POWER = '^'

function parseTokens(tokens, src) {
  let at = 0
  const peek = () => tokens[at]
  const take = (type) => {
    if (tokens[at].type !== type) {
      throw new ExprError(`expected ${type}, found ${tokens[at].type} in ${src}`)
    }
    return tokens[at++]
  }

  const parseBinary = (level) => {
    if (level >= BINARY_LEVELS.length) return parseUnary()
    let left = parseBinary(level + 1)
    while (BINARY_LEVELS[level].includes(peek().type)) {
      const op = tokens[at++].type
      left = { kind: 'binary', op, left, right: parseBinary(level + 1) }
    }
    return left
  }

  const parseUnary = () => {
    if (peek().type === 'not') { at++; return { kind: 'not', operand: parseUnary() } }
    if (peek().type === '-') { at++; return { kind: 'negate', operand: parseUnary() } }
    return parsePower()
  }

  const parsePower = () => {
    const base = parsePrimary()
    if (peek().type !== POWER) return base
    at++
    return { kind: 'binary', op: POWER, left: base, right: parseUnary() }
  }

  const parsePrimary = () => {
    const token = peek()
    if (token.type === 'number') { at++; return { kind: 'const', value: token.value } }
    if (token.type === 'string') { at++; return { kind: 'const', value: token.value } }
    if (token.type === 'true') { at++; return { kind: 'const', value: true } }
    if (token.type === 'false') { at++; return { kind: 'const', value: false } }
    if (token.type === '(') {
      at++
      const inner = parseBinary(0)
      take(')')
      return inner
    }
    if (token.type === 'name') {
      at++
      if (peek().type !== '(') return { kind: 'name', name: token.value }
      at++
      const args = []
      if (peek().type !== ')') {
        args.push(parseBinary(0))
        while (peek().type === ',') { at++; args.push(parseBinary(0)) }
      }
      take(')')
      return { kind: 'call', name: token.value, args }
    }
    throw new ExprError(`unexpected ${token.type} in ${src}`)
  }

  const ast = parseBinary(0)
  take('end')
  return ast
}

// Parsing the same handful of expressions on every element of every track adds
// up; the text is the key because it is what the catalogue holds.
const cache = new Map()

/** The syntax tree of `src`, parsed once and kept. */
export function parseExpr(src) {
  if (!cache.has(src)) cache.set(src, parseTokens(tokenize(src), src))
  return cache.get(src)
}

const number = (value, what) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExprError(`${what} is not a number: ${JSON.stringify(value)}`)
  }
  return value
}

function run(node, scope, fns) {
  switch (node.kind) {
    case 'const': return node.value
    case 'name': {
      if (!(node.name in scope)) throw new ExprError(`unknown name ${node.name}`)
      return scope[node.name]
    }
    case 'call': {
      // `if` picks a branch, so it is part of the language rather than one of
      // the functions: both arms may not be computed first, since one of them
      // is routinely the one that would divide by a radius that is zero on a
      // straight.
      if (node.name === 'if') {
        if (node.args.length !== 3) throw new ExprError('if takes three arguments')
        return run(node.args[0], scope, fns)
          ? run(node.args[1], scope, fns)
          : run(node.args[2], scope, fns)
      }
      const fn = fns[node.name]
      if (!fn) throw new ExprError(`unknown function ${node.name}`)
      return fn(...node.args.map(a => run(a, scope, fns)))
    }
    case 'not': return !run(node.operand, scope, fns)
    case 'negate': return -number(run(node.operand, scope, fns), 'negated value')
    case 'binary': {
      const { op } = node
      // Short-circuit, so `jump and r_w >= reg` may be written where r_w only
      // exists at a jump.
      if (op === 'and') return run(node.left, scope, fns) && run(node.right, scope, fns)
      if (op === 'or') return run(node.left, scope, fns) || run(node.right, scope, fns)
      const a = run(node.left, scope, fns)
      const b = run(node.right, scope, fns)
      if (op === '==') return a === b
      if (op === '!=') return a !== b
      const x = number(a, `left of ${op}`)
      const y = number(b, `right of ${op}`)
      switch (op) {
        case '+': return x + y
        case '-': return x - y
        case '*': return x * y
        case '/': return x / y
        case '%': return x % y
        case '^': return x ** y
        case '<': return x < y
        case '<=': return x <= y
        case '>': return x > y
        case '>=': return x >= y
        default: throw new ExprError(`unknown operator ${op}`)
      }
    }
    default: throw new ExprError(`unknown node ${node.kind}`)
  }
}

/**
 * Evaluate `src` over `scope` (a flat object of names) with `fns` (the
 * catalogue's functions). Throws on anything it cannot answer.
 */
export function evalExpr(src, scope, fns = {}) {
  return run(parseExpr(src), scope, fns)
}

export { ExprError }
