import { describe, it, expect } from 'vitest'
import { checkTrack } from './trassierungCheck'
import vectors from '../constraints/tests/checks.json'

// The same chains tools/optimizer/tests/vectors.py runs through its port of
// this check (olt_optimizer/pruefung.py).
const key = (f) => JSON.stringify(f)
function findings(elements) {
  const r = checkTrack(elements)
  const out = []
  for (const e of r.elements) for (const x of e.results ?? []) out.push([`#${e.index}`, x.id, x.severity])
  for (const e of r.ramps) for (const x of e.results) out.push([`#${e.index}`, x.id, x.severity])
  for (const e of r.boundaries) for (const x of e.results) out.push([`#${e.index}|#${e.index + 1}`, x.id, x.severity])
  return out.sort((a, b) => (key(a) < key(b) ? -1 : 1))
}

describe('catalogue check, shared vectors (R8.5)', () => {
  for (const chain of vectors.chains) {
    it(chain.name, () => {
      expect(findings(chain.elements)).toEqual([...chain.findings].sort((a, b) => (key(a) < key(b) ? -1 : 1)))
    })
  }
})
