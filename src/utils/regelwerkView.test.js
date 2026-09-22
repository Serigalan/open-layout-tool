import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenRegelwerk } from './regelwerkView'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dbRil800 = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'tools/optimizer/olt_optimizer/regelwerke/db-ril-800-0110.json'), 'utf-8'))

describe('flattenRegelwerk', () => {
  it('turns a small regelwerk into one row per leaf, in order', () => {
    const rows = flattenRegelwerk({
      id: 'x', name: 'X', version: '1', gueltig_ab: '2026-01-01',
      gruppe: {
        a: { wert: 1, einheit: 'mm', quelle: '', warum: 'weil' },
        b: { wert: 2 },
      },
    })
    expect(rows).toEqual([
      { path: 'gruppe.a', wert: 1, einheit: 'mm', quelle: '', warum: 'weil', woVerwendet: 'Optimierer' },
      { path: 'gruppe.b', wert: 2, einheit: '', quelle: '', warum: '', woVerwendet: 'Optimierer' },
    ])
  })

  it('does not treat id/name/version/gueltig_ab as rows', () => {
    const rows = flattenRegelwerk({ id: 'x', name: 'X', version: '1', gueltig_ab: '2026-01-01' })
    expect(rows).toEqual([])
  })

  it('recurses past a group that has no wert of its own', () => {
    const rows = flattenRegelwerk({ aussen: { innen: { tiefer: { wert: 5 } } } })
    expect(rows).toEqual([
      { path: 'aussen.innen.tiefer', wert: 5, einheit: '', quelle: '', warum: '', woVerwendet: 'Optimierer' },
    ])
  })

  it('reads a boolean wert (bestand.unterliegt_rampenregel) without treating it as a group', () => {
    const rows = flattenRegelwerk({ bestand: { unterliegt_rampenregel: { wert: false, warum: 'x' } } })
    expect(rows).toEqual([{
      path: 'bestand.unterliegt_rampenregel', wert: false, einheit: '', quelle: '', warum: 'x',
      woVerwendet: 'Optimierer — gilt für eine bestehende Lage nicht',
    }])
  })
})

describe('flattenRegelwerk against the real db-ril-800-0110.json', () => {
  const rows = flattenRegelwerk(dbRil800)

  it('finds at least the values optimize.py reads (AP R.2)', () => {
    const paths = rows.map(r => r.path)
    expect(paths).toEqual(expect.arrayContaining([
      'ueberhoehung.u_max', 'ueberhoehung.u_step', 'weiche.u_max', 'weiche.uf_max',
      'rampenregel.faktor_klothoide', 'rampenregel.faktor_bloss', 'mindestlaenge.koeffizient',
      'baubarkeitsraster.radius_schritt', 'baubarkeitsraster.radius_min', 'baubarkeitsraster.laenge_schritt',
    ]))
  })

  it('has a specific "wo verwendet" label for every row, not the generic fallback', () => {
    const generic = rows.filter(r => r.woVerwendet === 'Optimierer')
    expect(generic).toEqual([])
  })
})
