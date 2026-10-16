import { describe, it, expect } from 'vitest'
import { projectCrsOptions } from './coordinateUtils'

describe('projectCrsOptions', () => {
  it('lists the planes of the project, most used first, named', () => {
    const tracks = [{ epsg: 5678 }, { epsg: 25832 }, { epsg: 5678 }, { epsg: '5683' }]
    expect(projectCrsOptions(tracks)).toEqual([
      { code: 5678, label: 'DHDN / GK Zone 4', count: 2 },
      { code: 5683, label: 'DB_REF / GK Zone 3', count: 1 },
      { code: 25832, label: 'ETRS89 / UTM Zone 32N', count: 1 },
    ])
  })

  it('leaves out what it cannot name, and copes with no tracks', () => {
    expect(projectCrsOptions([{ epsg: 4326 }, {}])).toEqual([])
    expect(projectCrsOptions(undefined)).toEqual([])
  })
})
