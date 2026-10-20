import { describe, it, expect } from 'vitest'
import { connectionPartners, switchDetailScene } from './detailScene'
import { hydrateProjects } from '../project/persistenceUtils'
import { hasPekBestand, loadPekBestand } from '../../test/pekFixture'

// Tracks only as long as the search needs them: an id and a length.
const track = (id, length) => ({ id, elements: [{ length }] })
const port = (trackId, endpoint) => ({ trackId, endpoint })
const turnout = (switchId, ports) => ({ switchId, kind: 'turnout', ports })

describe('the partners of a switch connection', () => {
  // W1's branch b runs 60 m to W2's branch; W3's branch c runs 400 m on to W4.
  const tracks = [track('m1', 500), track('m2', 500), track('b', 60), track('c', 400), track('l1', 20), track('l2', 30)]
  const w1 = turnout('w1', { A: port('a', 'END'), B1: port('b', 'BEGIN'), B2: port('m1', 'BEGIN') })
  const w2 = turnout('w2', { A: port('x', 'END'), B1: port('b', 'END'), B2: port('m2', 'BEGIN') })
  const w3 = turnout('w3', { A: port('y', 'END'), B1: port('c', 'BEGIN'), B2: port('m1', 'END') })
  const w4 = turnout('w4', { A: port('z', 'END'), B1: port('c', 'END'), B2: port('m2', 'END') })

  it('is the turnout at the far end of the branch, found from either side', () => {
    const switches = [w1, w2, w3, w4]
    expect(connectionPartners(tracks, switches, w1).map(s => s.switchId)).toEqual(['w2'])
    expect(connectionPartners(tracks, switches, w2).map(s => s.switchId)).toEqual(['w1'])
  })

  it('is not a turnout farther off than a connection reaches', () => {
    expect(connectionPartners(tracks, [w1, w2, w3, w4], w3)).toEqual([])
  })

  it('is found across a link', () => {
    const v1 = turnout('v1', { A: port('a', 'END'), B1: port('l1', 'BEGIN'), B2: port('m1', 'BEGIN') })
    const link = { switchId: 'k', kind: 'link', ports: { A: port('l1', 'END'), B: port('l2', 'BEGIN') } }
    const v2 = turnout('v2', { A: port('x', 'END'), B1: port('l2', 'END'), B2: port('m2', 'BEGIN') })
    expect(connectionPartners(tracks, [v1, link, v2], v1).map(s => s.switchId)).toEqual(['v2'])
    expect(connectionPartners(tracks, [v1, link, v2], v2).map(s => s.switchId)).toEqual(['v1'])
  })
})

describe.skipIf(!hasPekBestand)('a turnout with its surroundings (PEK Bestand)', () => {
  // Loaded on first use: a skipped suite still runs its body.
  let pek = null
  const project = () => (pek ??= hydrateProjects([loadPekBestand()])[0])
  const named = (name) => project().switches.find(s => s.name === name)

  it('draws the other half of a crossover in the turnout’s frame, and the tracks around', () => {
    const { tracks, switches } = project()
    const scene = switchDetailScene(tracks, switches, named('0603'))
    expect(scene.partners.map(d => d.sw.name)).toEqual(['0604'])
    // The partner's WA is where its own detail puts it, carried into this frame.
    const back = switchDetailScene(tracks, switches, named('0604'))
    const toPlane = (d, q) => [d.origin[0] + q[0] * d.axes.x[0] + q[1] * d.axes.y[0], d.origin[1] + q[0] * d.axes.x[1] + q[1] * d.axes.y[1]]
    const a = toPlane(scene.detail, scene.partners[0].marks.WA)
    const b = toPlane(back.detail, back.detail.marks.WA)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6)
    // Both lie in the box the view is fitted to.
    const inFocus = (p) => p[0] >= scene.focus.x0 - 1e-6 && p[0] <= scene.focus.x1 + 1e-6
    expect(inFocus(scene.partners[0].marks.WA)).toBe(true)
    // Tracks as runs of two rails 1.5 m apart, inside the window.
    expect(scene.tracks.length).toBeGreaterThan(2)
    for (const run of scene.tracks) {
      expect(run.rails[0]).toHaveLength(run.rails[1].length)
      const [l, r] = [run.rails[0][0], run.rails[1][0]]
      expect(Math.hypot(l[0] - r[0], l[1] - r[1])).toBeCloseTo(1.5, 6)
    }
  })

  it('takes the turnouts close by along, but not the far end of a station track', () => {
    const { tracks, switches } = project()
    const scene = switchDetailScene(tracks, switches, named('0809'))
    expect(scene.partners).toEqual([])
    expect(scene.nearby.map(d => d.sw.name)).toContain('0808')
  })
})
