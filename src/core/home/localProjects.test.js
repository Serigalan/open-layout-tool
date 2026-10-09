import { describe, it, expect } from 'vitest'
import { summaryOf } from './localProjects'

describe('the projects of the local build (Paket L)', () => {
  it('lists a project by what it holds, without reading it whole again', () => {
    const record = {
      id: 'p1', createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-10T08:00:00Z',
      project: { id: 'p1', title: 'Halle', description: 'Bestand', image: 'data:image/png;base64,AA==',
        tracks: [{ id: 'a' }, { id: 'b' }], switches: [{ switchId: 'w' }] },
    }
    expect(summaryOf(record)).toEqual({
      id: 'p1', title: 'Halle', description: 'Bestand', image: 'data:image/png;base64,AA==',
      tracks: 2, switches: 1, platforms: 0, createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-10T08:00:00Z',
    })
  })

  it('takes a project without title, description or picture', () => {
    expect(summaryOf({ id: 'p2', project: { id: 'p2' } })).toMatchObject({ title: '', description: '', image: null, tracks: 0 })
  })
})
