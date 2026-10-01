import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hasPek, loadPek } from '../../test/pekFixture'
import { splitTrackAtJoint } from '../trackSplitUtils'
import { joinTracks } from '../../storage'
import { diffProject, diffSize, mergeProject, resolve } from './index'
import { primary } from './diff'

const SWITCH_1 = '00000000-0000-4000-8000-000000000001'
const A = 'a9f56232-878c-4eef-ab79-09131c7c1212'     // 6050.001, switch.001's toe at its END

const trackOf = (p, id) => p.tracks.find(t => t.id === id)
const switchOf = (p, id) => p.switches.find(s => s.switchId === id)
const len = (t) => t.elements.reduce((s, e) => s + e.length, 0)

/** Split track `id` of `p` at joint `j`, the way storage does it: pieces in, ports and marks repointed. */
function split(p, id, j) {
  const old = trackOf(p, id)
  const { tracks: [b, c] } = splitTrackAtJoint(old, j, old.elements[j].bearing, new Set())
  p.tracks = p.tracks.flatMap(t => (t.id === id ? [primary({ tracks: [b] }).tracks[0], primary({ tracks: [c] }).tracks[0]] : [t]))
  p.switches = p.switches.map(sw => {
    const out = { ...sw }
    for (const k of ['A', 'B1', 'B2']) {
      if (sw[`port${k}_trackId`] !== id) continue
      out[`port${k}_trackId`] = sw[`port${k}_endpoint`] === 'BEGIN' ? b.id : c.id
    }
    return out
  })
  return { b: trackOf(p, b.id), c: trackOf(p, c.id), log: [{ from: id, to: [b.id, c.id] }] }
}

describe.skipIf(!hasPek)('mergeProject — PEK Halle–Könnern', () => {
  it('a merge without changes gives the starting state', () => {
    const base = loadPek()
    const { merged, conflicts, applied } = mergeProject({ base, mine: loadPek(), theirs: loadPek() })
    expect(conflicts).toEqual([])
    expect(applied).toEqual([])
    expect(diffSize(diffProject(base, merged))).toBe(0)
  })

  it('diffProject names what was added, removed and changed, field by field', () => {
    const base = loadPek()
    const other = loadPek()
    other.title = 'Neu'
    trackOf(other, A).name = 'x'
    other.platforms.pop()
    other.switches[0].portA_endpoint = 'BEGIN'
    const d = diffProject(base, other)
    expect(d.project.changed).toEqual(['title'])
    expect(d.tracks.changed).toEqual([expect.objectContaining({ id: A, fields: ['name'] })])
    expect(d.platforms.removed).toHaveLength(1)
    expect(d.switches.changed[0].fields).toEqual(['ports'])
  })

  it('rule 2: different fields of one track are both taken', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    trackOf(mine, A).name = 'meins'
    trackOf(theirs, A).speed = 80
    const { merged, conflicts, applied } = mergeProject({ base, mine, theirs })
    expect(conflicts).toEqual([])
    expect(trackOf(merged, A)).toMatchObject({ name: 'meins', speed: 80 })
    expect(applied).toEqual([expect.objectContaining({ collection: 'tracks', id: A, kind: 'changed', fields: ['speed'] })])
  })

  it('rule 2: the same field changed alike is no conflict, differently it is one', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    trackOf(mine, A).name = 'gleich'
    trackOf(theirs, A).name = 'gleich'
    expect(mergeProject({ base, mine, theirs }).conflicts).toEqual([])

    trackOf(theirs, A).name = 'anders'
    const { conflicts, merged } = mergeProject({ base, mine, theirs })
    expect(conflicts).toEqual([expect.objectContaining({
      collection: 'tracks', objectId: A, field: 'name', kind: 'field',
      base: '6050.001', mine: 'gleich', theirs: 'anders', label: '6050-1',
    })])
    expect(trackOf(merged, A).name).toBe('gleich')
  })

  it('the geometry of both sides is one field: any two edits of it conflict', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    trackOf(mine, A).elements[0].speed = 70
    trackOf(theirs, A).elements[40].speed = 90
    const { conflicts } = mergeProject({ base, mine, theirs })
    expect(conflicts.map(c => c.field)).toEqual(['elements'])
  })

  it('the ports of a switch are merged as one field', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    switchOf(mine, SWITCH_1).portA_endpoint = 'BEGIN'
    switchOf(theirs, SWITCH_1).portB1_endpoint = 'END'
    const { conflicts } = mergeProject({ base, mine, theirs })
    expect(conflicts.map(c => c.id)).toEqual([`switches:${SWITCH_1}:ports`])
  })

  it('rule 3: deleted against changed is a conflict, deleted against deleted is not', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const pf = base.platforms[0].id
    mine.platforms = mine.platforms.filter(p => p.id !== pf)
    theirs.platforms.find(p => p.id === pf).stationName = 'Trotha'
    const r = mergeProject({ base, mine, theirs })
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: 'deleted_changed', objectId: pf, field: null })])
    expect(r.merged.platforms.find(p => p.id === pf)).toBeUndefined()
    expect(resolve(r, { [r.conflicts[0].id]: 'theirs' }).platforms.find(p => p.id === pf).stationName).toBe('Trotha')

    theirs.platforms = theirs.platforms.filter(p => p.id !== pf)
    const both = mergeProject({ base, mine, theirs })
    expect(both.conflicts).toEqual([])
    expect(both.merged.platforms.find(p => p.id === pf)).toBeUndefined()
  })

  it('an unchanged object the other side deleted goes, and that is listed', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const pf = base.platforms[1].id
    theirs.platforms = theirs.platforms.filter(p => p.id !== pf)
    const { merged, applied } = mergeProject({ base, mine, theirs })
    expect(merged.platforms.find(p => p.id === pf)).toBeUndefined()
    expect(applied).toEqual([expect.objectContaining({ kind: 'removed', id: pf })])
  })

  it('rule 4: a km line new on both sides conflicts where they differ', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    mine.kmLines = [{ lineNumber: 6050, runs: [[[11.9, 51.5, 0]]] }]
    theirs.kmLines = [{ lineNumber: 6050, runs: [[[11.9, 51.5, 0]]] }]
    expect(mergeProject({ base, mine, theirs }).conflicts).toEqual([])
    theirs.kmLines = [{ lineNumber: 6050, runs: [[[11.9, 51.5, 1]]] }]
    const { conflicts } = mergeProject({ base, mine, theirs })
    expect(conflicts).toEqual([expect.objectContaining({ kind: 'both_added', collection: 'kmLines', objectId: '6050' })])
  })

  it('rule 5: a switch and a platform the other side put on a split track follow it to the right piece', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const { b, c, log } = split(mine, A, 30)
    expect(switchOf(mine, SWITCH_1).portA_trackId).toBe(c.id)

    const tA = trackOf(theirs, A)
    const L = len(tA), lb = len(b)
    theirs.platforms.push({ id: 'pf-new', trackId: A, startStation: L - 300, endStation: L - 150, side: 'left' })
    theirs.platforms.push({ id: 'pf-front', trackId: A, startStation: 100, endStation: 200, side: 'right' })
    theirs.endMarks = [{ id: 'm1', kind: 'bufferStop', trackId: A, endpoint: 'BEGIN' }]
    switchOf(theirs, SWITCH_1).speed = 40

    const { merged, conflicts, applied } = mergeProject({ base, mine, theirs, remapsMine: log })
    expect(conflicts).toEqual([])
    const pf = merged.platforms.find(p => p.id === 'pf-new')
    expect(pf.trackId).toBe(c.id)
    expect(pf.startStation).toBeCloseTo(L - 300 - lb, 2)
    expect(pf.endStation).toBeCloseTo(L - 150 - lb, 2)
    expect(merged.platforms.find(p => p.id === 'pf-front')).toMatchObject({ trackId: b.id, startStation: 100, endStation: 200 })
    expect(merged.endMarks).toEqual([expect.objectContaining({ trackId: b.id, endpoint: 'BEGIN' })])
    expect(switchOf(merged, SWITCH_1)).toMatchObject({ portA_trackId: c.id, portA_endpoint: 'END', speed: 40 })
    // The platform the data set already had on A is carried too: the split
    // left it naming A on mine as well.
    const existing = base.platforms.find(p => p.trackId === A).id
    expect(applied.filter(a => a.kind === 'carried').map(a => a.id).sort()).toEqual([existing, 'm1', 'pf-front', 'pf-new'].sort())
  })

  it('rule 5: a switch the other side hung on a split track goes to the piece with that end', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const { b, log } = split(mine, A, 30)
    // Theirs repoints switch.001's toe from A.END to A.BEGIN.
    switchOf(theirs, SWITCH_1).portA_endpoint = 'BEGIN'
    // Mine left that switch alone apart from the split's own repoint, so its
    // ports changed on both sides — as they did.
    const { conflicts } = mergeProject({ base, mine, theirs, remapsMine: log })
    expect(conflicts.map(c => c.field)).toEqual(['ports'])
    // A new switch theirs added at A.BEGIN goes to b.BEGIN.
    const t2 = loadPek()
    t2.switches.push({ ...switchOf(t2, SWITCH_1), switchId: 'sw-new', portA_trackId: A, portA_endpoint: 'BEGIN' })
    const r = mergeProject({ base, mine, theirs: t2, remapsMine: log })
    expect(switchOf(r.merged, 'sw-new')).toMatchObject({ portA_trackId: b.id, portA_endpoint: 'BEGIN' })
  })

  it('rule 5: a platform across the cut cannot be carried and keeps its old track', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const { b, log } = split(mine, A, 30)
    const lb = len(b)
    theirs.platforms.push({ id: 'pf-cut', trackId: A, startStation: lb - 50, endStation: lb + 50, side: 'left' })
    const { merged } = mergeProject({ base, mine, theirs, remapsMine: log })
    expect(merged.platforms.find(p => p.id === 'pf-cut').trackId).toBe(A)
  })

  it('rule 5: the other side changed the split track itself — deleted against changed, with the hint', () => {
    const base = loadPek(), mine = loadPek(), theirs = loadPek()
    const { log } = split(mine, A, 30)
    trackOf(theirs, A).speed = 100
    const { conflicts } = mergeProject({ base, mine, theirs, remapsMine: log })
    expect(conflicts).toEqual([expect.objectContaining({ kind: 'deleted_changed', objectId: A, hint: 'split' })])
  })

  it('rule 5 the other way round: references on a track that was joined move along it', () => {
    const base = loadPek()
    const { b, c } = split(base, A, 30)
    const mine = structuredClone(base), theirs = structuredClone(base)
    const joined = primary({ tracks: [joinTracks(trackOf(mine, b.id), trackOf(mine, c.id))] }).tracks[0]
    mine.tracks = mine.tracks.filter(t => t.id !== c.id).map(t => (t.id === b.id ? joined : t))
    switchOf(mine, SWITCH_1).portA_trackId = b.id
    const log = [{ from: c.id, to: [b.id] }]

    const lb = len(b)
    theirs.platforms.push({ id: 'pf-c', trackId: c.id, startStation: 10, endStation: 60, side: 'left' })
    theirs.endMarks = [{ id: 'm-c', kind: 'boundary', trackId: c.id, endpoint: 'BEGIN' }]
    const { merged } = mergeProject({ base, mine, theirs, remapsMine: log })
    const pf = merged.platforms.find(p => p.id === 'pf-c')
    expect(pf.trackId).toBe(b.id)
    expect(pf.startStation).toBeCloseTo(lb + 10, 2)
    // c.BEGIN is the joint now, no end any more: the mark cannot follow.
    expect(merged.endMarks[0].trackId).toBe(c.id)
  })
})

describe('the merge module under plain Node', () => {
  it('loads and merges without a DOM or the bundler', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url))
    const script = `
      const { mergeProject } = await import('./src/utils/merge/index.js')
      const p = { id: 'p', title: 'a', tracks: [], switches: [] }
      const r = mergeProject({ base: p, mine: { ...p, title: 'b' }, theirs: p })
      console.log(JSON.stringify([typeof window, r.merged.title, r.conflicts.length]))`
    const out = spawnSync(process.execPath, ['--import', './tools/server/src/register.mjs', '--input-type=module', '-e', script],
      { cwd: root, encoding: 'utf8' })
    expect(out.stderr).toBe('')
    expect(JSON.parse(out.stdout.trim())).toEqual(['undefined', 'b', 0])
  })
})
