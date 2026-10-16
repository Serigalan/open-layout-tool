import { describe, it, expect } from 'vitest'
import { solveSplice } from './solveSplice'
import { spliceRemedies } from './spliceRemedies'

// Two straights at 80 km/h that almost line up, 17 m apart and 1.5° off — as
// koennern.001 and 6344.02892 in the PEK Halle–Könnern project — joined by an
// arc of R 500 at 60 km/h without transitions: the joints are judged at the
// faster 80 km/h, where LP.KS.01 wants a comparison radius of 710 m at least.
const straight = (start, end, bearing, length) => ({
  start, end, bearing, radius: null, cant: 0, speed: 80, length, before: 0, after: 0,
})
const request = {
  dep: straight([4485139.295, 5726444.840], [4484607.898, 5726874.703], 308.9704, 683.495),
  arr: straight([4484578.845, 5726898.882], [4484594.772, 5726885.294], 130.4696, 20.936),
  radius: 500, speed: 60, cant: 0, lDep: 0, lArr: 0, modeDep: 'fixed', modeArr: 'fixed', arcJoin: 'straight',
}
const remediesFor = (req) => {
  const sol = solveSplice(req).solutions[0]
  return spliceRemedies({
    request: req, key: `${sol.ends.join()}|${sol.arcJoin ?? ''}`, elements: sol.elements, findings: sol.findings,
    solve: async (r) => solveSplice(r),
  })
}

describe('ways out of a curvature jump the rules reject', () => {
  it('finds the jump an error at the faster speed of the picks', () => {
    const sol = solveSplice(request).solutions[0]
    expect(sol.findings.filter(f => f.id === 'LP.KS.01').map(f => f.severity)).toEqual(['error', 'error'])
  })

  it('lowers the speed to 65 km/h or widens the arc to 710 m; transitions do not fit', async () => {
    const out = await remediesFor(request)
    expect(out.map(r => r.kind)).toEqual(['speed', 'radius'])
    const [speed, radius] = out
    expect(speed.speed).toBe(65)
    expect(speed.request.dep.speed).toBe(65)
    expect(speed.request.arr.speed).toBe(65)
    expect(speed.request.speed).toBe(60)
    expect(speed.worst).toBe('warning')   // the Ermessensgrenze
    expect(radius.radius).toBe(710)
    // Wider, the arc leaves too little of the short straight: said, not hidden.
    expect(radius.remaining).toContainEqual(expect.objectContaining({ id: 'LP.EL.01', severity: 'error' }))
  })

  it('has nothing to offer where the jump passes', async () => {
    const slow = { ...request, dep: { ...request.dep, speed: 60 }, arr: { ...request.arr, speed: 60 } }
    expect(await remediesFor(slow)).toEqual([])
  })
})
