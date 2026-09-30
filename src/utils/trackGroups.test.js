import { describe, it, expect } from 'vitest'
import {
  trackKind, trackTypeName, trackGroupKey, groupTracks, groupTitle, assignTracks,
} from './trackGroups'
import { buildTypeFields } from './identifierUtils'

const line = (id, lineNumber, extra = {}) => ({ id, name: id, trackType: 1, lineNumber, ...extra })
const station = (id, stationName, extra = {}) => ({ id, name: id, trackType: 2, stationName, ...extra })

describe('what a track belongs to', () => {
  it('is what its type says', () => {
    expect(trackKind({ trackType: 1 })).toBe('line')
    expect(trackKind({ trackType: 2, lineNumber: 6340 })).toBe('station')
  })

  it('is read off its fields where it states no type', () => {
    expect(trackKind({ lineNumber: '6340' })).toBe('line')
    // A station track keeps the line number its kilometrage is read off.
    expect(trackKind({ lineNumber: 6340, stationName: 'Könnern' })).toBe('station')
    expect(trackKind({ uicStation: '8010205' })).toBe('station')
    expect(trackKind({ name: 'track 1' })).toBe(null)
  })

  it('opens the forms on the type it has', () => {
    expect(trackTypeName({ stationName: 'Könnern' }, 'line_track')).toBe('station_track')
    expect(trackTypeName({}, 'line_track')).toBe('line_track')
  })

  it('is written by the forms', () => {
    expect(trackKind(buildTypeFields({ type: 'station_track', stationName: '' }))).toBe('station')
    expect(trackKind(buildTypeFields({ type: 'line_track', lineNumber: '' }))).toBe('line')
  })

  it('is grouped by line number, and by station name whatever its case', () => {
    expect(trackGroupKey(line('a', 6340))).toBe('line:6340')
    expect(trackGroupKey(station('a', ' Halle (Saale) Hbf '))).toBe('station:halle (saale) hbf')
    expect(trackGroupKey(station('a', null, { uicStation: '8010159' }))).toBe('station:#8010159')
    // A line track without a number names no line.
    expect(trackGroupKey(line('a', null))).toBe(null)
  })
})

describe('the tracks in groups', () => {
  const tracks = [
    station('s2', 'Könnern', { uicStation: '8010205' }),
    { id: 'x', name: 'loose' },
    line('l10', 6340, { name: '6340.10', lineName: 'Halle–Könnern' }),
    line('l2', '6340', { name: '6340.2' }),
    line('m', 6343),
    station('s1', 'könnern'),
    station('h', 'Halle (Saale) Hbf'),
  ]
  const groups = groupTracks(tracks)

  it('are lines by number, then stations by name, then the unassigned', () => {
    expect(groups.map(g => g.key)).toEqual([
      'line:6340', 'line:6343', 'station:halle (saale) hbf', 'station:könnern', 'none',
    ])
  })

  it('hold their tracks sorted by name, numbers counted', () => {
    expect(groups[0].tracks.map(tr => tr.id)).toEqual(['l2', 'l10'])
  })

  it('are named by the first track that names them', () => {
    expect(groupTitle(groups[0])).toBe('6340 · Halle–Könnern')
    expect(groupTitle(groups[3])).toBe('Könnern')
    expect(groups[3].uicStation).toBe('8010205')
  })

  it('leave out the unassigned group when every track belongs somewhere', () => {
    expect(groupTracks([line('a', 6340)]).map(g => g.key)).toEqual(['line:6340'])
    expect(groupTracks([])).toEqual([])
  })
})

describe('assigning tracks', () => {
  const tracks = [
    line('a', 6340, { lineName: 'Halle–Könnern', side: 1 }),
    station('b', 'Könnern', { lineNumber: 6340, trackNumber: 3 }),
    { id: 'c' },
  ]

  it('puts them on a line, leaving the others as they are', () => {
    const out = assignTracks(tracks, ['b', 'c'], { kind: 'line', lineNumber: ' 6343 ', lineName: '' })
    expect(out[0]).toBe(tracks[0])
    expect(trackGroupKey(out[1])).toBe('line:6343')
    expect(out[2]).toMatchObject({ trackType: 1, lineNumber: 6343, lineName: null })
    // What only the other kind states stays: it may be wanted back.
    expect(out[1].trackNumber).toBe(3)
  })

  it('puts them into a station, keeping the line their kilometrage is read off', () => {
    const [a] = assignTracks(tracks, ['a'], { kind: 'station', stationName: 'Halle (Saale) Hbf', uicStation: '8010159' })
    expect(trackGroupKey(a)).toBe('station:halle (saale) hbf')
    expect(a.lineNumber).toBe(6340)
  })

  it('takes them out of what they were in', () => {
    const out = assignTracks(tracks, ['a', 'b'], { kind: null })
    expect(out.slice(0, 2).map(trackGroupKey)).toEqual([null, null])
    expect(groupTracks(out).map(g => g.key)).toEqual(['none'])
  })
})
