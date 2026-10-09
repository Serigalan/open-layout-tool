import { describe, it, expect } from 'vitest'
import { schematicLayout, schematicNetwork } from './planSchematic'

import { tracks, switches, platforms, straight } from '../test/schematicFixture'

describe('schematic network', () => {
  it('joins the tracks through the turnouts into strands', () => {
    const { strands } = schematicNetwork(tracks, switches)
    const names = strands.map(st => st.parts.map(p => p.track.id).join('+')).sort()
    expect(names).toEqual(['1a+1b', '2a+2b+2c', 'S', 'X'])
  })
})

describe('schematic layout', () => {
  const layout = schematicLayout({ tracks, switches, platforms })
  const strand = (id) => layout.strands.find(st => st.parts.some(p => p.track.id === id))

  it('lays the longest strand on lane 0 and the others outwards by side', () => {
    expect(layout.ref).toBe(strand('1a'))
    expect(strand('1a').lane).toBe(0)
    expect(strand('2a').lane).toBe(1)
    expect(strand('S').lane).toBe(2)
  })

  it('draws the crossover as a connection, not a lane', () => {
    expect(strand('X').connector).toBe(true)
    expect(strand('X').lane).toBeUndefined()
  })

  it('puts a switch where it is along the line', () => {
    const w1 = layout.nodes.find(n => n.sw.name === 'W1')
    expect(w1.x).toBeCloseTo(400, 0)
    expect(w1.lane).toBe(0)
  })

  it('places a platform on the side it stands on', () => {
    const [pf] = layout.platforms
    expect(pf.x0).toBeCloseTo(800, 0)
    expect(pf.x1).toBeCloseTo(1000, 0)
    expect(pf.up).toBe(false)
  })

  it('falls back to the chainage along the reference without a kilometrage line', () => {
    expect(layout.kmTable[0].km).toBeCloseTo(layout.kmTable[0].x)
  })

  it('leaves out what lies beyond the corridor', () => {
    const far = [...tracks, straight('F', 0, 900, 90, 1500)]
    const narrow = schematicLayout({ tracks: far, switches, corridor: 100 })
    const f = narrow.strands.find(st => st.parts[0].track.id === 'F')
    expect(f.outside).toBe(true)
    expect(f.lane).toBeUndefined()
  })
})
