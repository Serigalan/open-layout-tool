// How the element table may change each element (Entscheidung 375): Fest-,
// Folge- or Zwischenelement — the roles an element states (`role`, oltjson-1.1)
// and the ones that follow from them.

const isTransition = (el) => el?.elementType === 2
const inSwitch = (el) => el?.switchId != null

/**
 * The elements a Zwischenelement at `z` is worked out between: the nearest
 * element on each side that is not a transition (`a` before, `b` after) — or
 * the reason it cannot be one, as a locale key: a transition or a switch route
 * itself, no such element on a side, or a switch route between them.
 */
export function intermediateSpan(elements, z) {
  const el = elements[z]
  if (!el || isTransition(el) || inSwitch(el)) return { error: 'table_role_intermediate_kind' }
  let a = z - 1
  while (a >= 0 && isTransition(elements[a])) a--
  let b = z + 1
  while (b < elements.length && isTransition(elements[b])) b++
  if (a < 0 || b >= elements.length) return { error: 'table_role_intermediate_ends' }
  if (elements.slice(a, b + 1).some(inSwitch)) return { error: 'table_role_intermediate_switch' }
  return { a, b, error: null }
}

/**
 * The role each element has, stated or following from one that is, as
 * { role, by, length, radius } — `role` 'fixed', 'follow' or 'intermediate',
 * `by` the index of the element whose role it follows from (null where it
 * states its own or none), `length` / `radius` whether the table takes a typed
 * value there.
 *
 *   – Festelement: neither — the element stays as it is.
 *   – Folgeelement: the first element that states `follow`, and every one
 *     after it: length and radius are typed, each starts where the one before
 *     ends. A switch route keeps its form's dimensions all the same.
 *   – Zwischenelement: its radius is typed (its length is worked out); the
 *     elements of its span (intermediateSpan) follow it, their lengths worked
 *     out too. One whose span cannot be had, or reaches a Folgeelement or
 *     another span, is a Festelement and says why (`error`).
 */
export function elementRoles(elements = []) {
  const out = elements.map(() => ({ role: 'fixed', by: null, length: false, radius: false, error: null }))
  const first = elements.findIndex(el => el.role === 'follow')
  const from = first < 0 ? elements.length : first
  for (let i = from; i < elements.length; i++) {
    const own = !inSwitch(elements[i])
    out[i] = {
      role: 'follow', by: i === from ? null : from, error: null,
      length: own, radius: own && !isTransition(elements[i]),
    }
  }
  let taken = -1
  elements.forEach((el, z) => {
    if (el.role !== 'intermediate' || z >= from) return
    const span = intermediateSpan(elements, z)
    const error = span.error ?? (span.b >= from ? 'table_role_intermediate_follow'
      : span.a <= taken ? 'table_role_intermediate_overlap' : null)
    if (error) { out[z] = { ...out[z], error }; return }
    for (let i = span.a; i <= span.b; i++) {
      out[i] = i === z
        ? { role: 'intermediate', by: null, length: false, radius: true, error: null, span }
        : { role: 'follow', by: z, length: false, radius: false, error: null }
    }
    taken = span.b
  })
  return out
}

/** The roles an element may be given: a transition or a switch route no Zwischenelement. */
export const rolesFor = (el) => (isTransition(el) || inSwitch(el) ? ['fixed', 'follow'] : ['fixed', 'follow', 'intermediate'])

const withoutRole = ({ role: _r, ...el }) => el

/**
 * The elements with element `i` given `role` ('fixed', 'follow' or
 * 'intermediate'), as the record states roles: only where it is set, the ones
 * that follow from it not. A Folgeelement makes every element after it one,
 * so what they stated goes, and so do Zwischenelemente whose span reaches it;
 * a Zwischenelement takes over its span. Returns { elements, error } — error
 * the locale key where the role cannot be given.
 */
export function withRole(elements, i, role) {
  const el = elements[i]
  if (!el) return { elements, error: null }
  if (role === 'fixed') {
    return { elements: elements.map((e, j) => (j === i ? withoutRole(e) : e)), error: null }
  }
  if (role === 'follow') {
    const out = elements.map((e, j) => {
      if (j === i) return { ...e, role: 'follow' }
      if (j > i) return withoutRole(e)
      if (e.role === 'intermediate' && (intermediateSpan(elements, j).b ?? -1) >= i) return withoutRole(e)
      return e
    })
    return { elements: out, error: null }
  }
  const span = intermediateSpan(elements, i)
  if (span.error) return { elements, error: span.error }
  const out = elements.map((e, j) => {
    if (j === i) return { ...e, role: 'intermediate' }
    if (j >= span.a && j <= span.b) return withoutRole(e)
    // Another Zwischenelement whose span reaches into this one gives way.
    if (e.role === 'intermediate') {
      const other = intermediateSpan(elements, j)
      if (!other.error && other.a <= span.b && other.b >= span.a) return withoutRole(e)
    }
    return e
  })
  return { elements: out, error: null }
}
