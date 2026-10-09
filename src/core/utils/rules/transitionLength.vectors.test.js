import { describe, it, expect } from 'vitest'
import { transitionLengths } from './transitionLength'
import vectors from '../../constraints/tests/transition_lengths.json'

// The same cases tools/optimizer/tests/vectors.py asks the service's
// transition_lengths (olt_optimizer/grenzen.py): the splice finds its lengths
// there, "Gerade/Bogen verbinden" here, and the two have to agree.
const rows = (by) => by.map(b => [b.id, b.length, b.binding])

describe('shortest transition lengths, shared vectors (Paket S)', () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const got = transitionLengths({ prev: c.prev, next: c.next, r1: c.r1, type: c.type, speed: c.speed })
      expect(got.regular).toBe(c.regular)
      expect(got.minimum).toBe(c.minimum)
      for (const [key, want] of [['regularBy', c.regularBy], ['minimumBy', c.minimumBy]]) {
        const have = rows(got[key])
        expect(have.map(r => [r[0], r[2]])).toEqual(want.map(r => [r[0], r[2]]))
        have.forEach((r, i) => expect(r[1]).toBeCloseTo(want[i][1], 6))
      }
    })
  }
})
