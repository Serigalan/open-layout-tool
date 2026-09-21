import {
  mdbGradientChains, stationIndex, gradientForTrack, stationsAlong, bstOf,
} from './mdbGradient'
import {
  buildTracksFromCsv,
  TYPE_STRAIGHT, TYPE_KINK, TYPE_ARC, TYPE_CLOTHOID, TYPE_BLOSS,
  CANT_CONSTANT,
} from './gleislageCsvImport'

/**
 * Adapter for the DB ASCII interface delivered as an Access database (Satzarten
 * 11–41, one table per Satzart). The converter on the server turns the tables
 * into the payload this module consumes; everything fachliche happens here,
 * where it is testable.
 *
 * The geometry is the same data model the Gleislage CSV carries, so the rows
 * built here are handed to `buildTracksFromCsv` rather than laid out a second
 * time — see ROADMAP decision 29.
 */

const GON2DEG = 0.9

/**
 * Lagesystem → EPSG.
 *
 * The interface names a plane with three characters: the meridian strip it is
 * computed in, the frame, and a serial digit. `ER0` is DB_REF in the 12°
 * strip, `EA0` the DHDN before it, `DB0` Thüringen's PD/83 in the 9° strip.
 *
 *   strip   C 6°E   D 9°E   E 12°E   F 15°E        → Gauss-Krüger zone 2…5
 *   frame   A  RD/83, Bessel, Rauenberg — the western states and Sachsen
 *           B  PD/83, Bessel, Potsdam — Thüringen
 *           C  42/83, Krassowski, Pulkowo — Brandenburg, Mecklenburg,
 *              Sachsen-Anhalt
 *           S  Soldner Netz 88, Müggelturm — Berlin, one net without a strip
 *           R  DB_REF, the railway's own frame
 *
 * `A` is the one that is not a single EPSG realisation. The key calls it
 * RD/83, and EPSG defines RD/83 only over Sachsen (3398/3399) while the same
 * Rauenberg-based plane in the west is DHDN (5676–5680). Nothing in a file
 * says which state a chain lies in, so all of `A` is read as DHDN and
 * converted on BeTA2007, the AdV's nationwide transition — inside Sachsen
 * that is about half a metre off RD/83's own grid (ntv2Grid).
 *
 * A frame is missing from a strip where that combination has no plane: PD/83
 * is Thüringen and so exists in zones 3 and 4 only, 42/83 in 3 to 5. Such a
 * code is reported as unassigned rather than bent onto a neighbour.
 */
const SYS_ZONE = { C: 2, D: 3, E: 4, F: 5 }

const SYS_CODE = {
  A: { 2: 5676, 3: 5677, 4: 5678, 5: 5679 },
  B: { 3: 3396, 4: 3397 },
  C: { 3: 2397, 4: 2398, 5: 2399 },
  R: { 2: 5682, 3: 5683, 4: 5684, 5: 5685 },
}

/** Berlin's Soldner net — the one plane that is not a Gauss-Krüger strip. */
const SOLDNER_EPSG = 3068

/** EPSG of a Lagesystem code, or null where that combination has no plane. */
export function epsgForLagesystem(sys) {
  const code = String(sys ?? '').trim().toUpperCase()
  if (code[1] === 'S') return SOLDNER_EPSG
  const zone = SYS_ZONE[code[0]]
  return (zone && SYS_CODE[code[1]]?.[zone]) ?? null
}

/**
 * Element type codes of Satzart 21. 3 and 7 are further transition forms with
 * no equivalent in the model; they keep their code so the report can name them.
 */
const ELTYP_NAME = {
  0: TYPE_STRAIGHT,
  1: TYPE_ARC,
  2: TYPE_CLOTHOID,
  4: TYPE_BLOSS,
  5: TYPE_KINK,
}

/**
 * Bauform prefix → the record kind, and how many nodes the source splits it
 * into. `EABKW`/`EBKW` are curved variants of the einfache Kreuzungsweiche, so
 * they belong to `EKW`, not to the turnouts.
 */
const KIND_BY_PREFIX = {
  DKW:   { kind: 'double_slip', nodes: 4 },
  EKW:   { kind: 'single_slip', nodes: 2 },
  EABKW: { kind: 'single_slip', nodes: 2 },
  EBKW:  { kind: 'single_slip', nodes: 2 },
  KR:    { kind: 'crossing',    nodes: 1 },
  BKR:   { kind: 'crossing',    nodes: 1 },
  EW:    { kind: 'turnout',     nodes: 1 },
  ABW:   { kind: 'turnout',     nodes: 1 },
  IBW:   { kind: 'turnout',     nodes: 1 },
  SYM:   { kind: 'turnout',     nodes: 1 },
  DW:    { kind: 'turnout',     nodes: 1 },
}

/** Satzart 31 node types that carry a Bauteil. */
const KNTYP_SWITCH = 1
const KNTYP_CROSSING = 4

/** `KNOTEN` is a fixed 15-char key: Betriebsstelle in 0–9, number in 10–14. */
export function splitKnoten(knoten) {
  const t = String(knoten ?? '')
  return { bst: t.slice(0, 10).trim(), nr: t.slice(10, 15).trim() }
}

const padKey = (a, b) => `${a}\u0000${b}`

/**
 * Bauform as free text → the parts the model needs. The source writes it by
 * hand: `EW 54-190-1:9`, `tlw IBW 54-500-1:12 iU`, `ABW / IBW 54-500-1:12 iU`,
 * `SYM ABW 54-215-1:4,8`, `Kr 54-1:9`, `unbekannt`.
 *
 * `radius` is null where the form states none (crossings). Anything the
 * expression cannot place stays null and the caller reports it — a switch of
 * the wrong form is worse than a missing one.
 */
export function parseBauform(text) {
  const raw = String(text ?? '').trim()
  const out = { raw, prefix: null, kind: null, rail: null, radius: null, n: null }
  if (!raw) return out

  // Strip the qualifiers that say how much of the switch lies in a curve; they
  // are a property of the alignment, not of the form (`sw.bauform` is derived).
  const core = raw.replace(/\b(tlw\.?|z\.?\s?T\.?|i\.?\s?U\.?)\b/gi, ' ').trim()

  const word = /^([A-Za-z]+)/.exec(core)
  if (word) {
    out.prefix = word[1].toUpperCase()
    out.kind = KIND_BY_PREFIX[out.prefix]?.kind ?? null
  }

  const slope = /1\s*[:]\s*(\d+(?:[.,]\d+)?)/.exec(core)
  if (slope) out.n = Number(slope[1].replace(',', '.'))

  // Numbers before the `1:n`, in source order: [rail?, radius?]. A rail profile
  // is 49/54/60; anything else in that position is not one and is left out.
  const head = core.slice(0, slope ? slope.index : core.length)
  const nums = [...head.matchAll(/\b(\d{2,4})\b/g)].map(m => Number(m[1]))
  if (nums.length >= 2) {
    if ([49, 54, 60].includes(nums[0])) out.rail = nums[0]
    out.radius = nums[nums.length - 1]
  } else if (nums.length === 1) {
    if ([49, 54, 60].includes(nums[0])) out.rail = nums[0]
    else out.radius = nums[0]
  }
  return out
}

/** Rail profile name as `gaugeProfiles` spells it. */
export const RAIL_NAME = { 49: 'S49', 54: 'S54', 60: 'UIC60' }

/**
 * Normalise the converter's payload. Every array is optional so a partial
 * export still yields what it has; missing ones simply produce no rows.
 */
export function parseMdbPayload(json) {
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    points:   arr(json?.points),
    elements: arr(json?.elements),
    cants:    arr(json?.cants),
    tracks:   arr(json?.tracks),
    nodes:    arr(json?.nodes),
    // The vertical alignment: where a point is stationed (Satzart 11), how
    // high it is (13) and the gradient between them (22) — mdbGradient.
    stations:  arr(json?.stations),
    heights:   arr(json?.heights),
    gradients: arr(json?.gradients),
  }
}

/**
 * Point coordinates keyed by `PAD` and Lagesystem — a point is delivered once
 * per system it was computed in, and the element says which one it belongs to.
 */
function pointIndex(points) {
  const idx = new Map()
  for (const p of points) {
    if (!Number.isFinite(p?.y) || !Number.isFinite(p?.x)) continue
    idx.set(padKey(p.pad, p.sys), [p.y, p.x])
  }
  return idx
}

/**
 * Which line number(s) an element belongs to. The elements themselves carry
 * none — the Gleisabschnitt (Satzart 33) does, and it names its elements
 * through its ordered PAD chain.
 */
function streckeByElement(tracks) {
  const byPair = new Map()
  for (const t of tracks) {
    const chain = Array.isArray(t?.chain) ? t.chain : []
    const strecke = String(t?.strecke ?? '').trim()
    if (!strecke) continue
    for (let i = 0; i + 1 < chain.length; i++) {
      const key = padKey(chain[i], chain[i + 1])
      let set = byPair.get(key)
      if (!set) { set = new Set(); byPair.set(key, set) }
      set.add(strecke)
    }
  }
  return byPair
}

/**
 * The line number an element without a Gleisabschnitt is filed under.
 *
 * Satzart 33 is what gives an element its Streckennummer, and an export can
 * leave it out altogether: a geometry-only delivery (Satzarten 11–25) carries
 * the alignment and no sections at all. Those elements used to be counted and
 * dropped, which makes such a file import as nothing.
 *
 * So they are grouped by what the file does say about them — the
 * Trassenbezeichnung the element carries (`ELTEXT`, written `Trasse:…` by the
 * planning tool), else the Betriebsstelle its point address begins with. Both
 * are names where a Streckennummer would be a number, so the line picker shows
 * at a glance which is which, and the report says how many came in this way.
 */
const TRASSE = /^Trasse:\s*(\S.*)$/

function looseStrecke(el) {
  const named = TRASSE.exec(String(el?.text ?? '').trim())
  if (named) return new Set([named[1].trim()])
  const bst = String(el?.pad1 ?? '').slice(0, 4).trim()
  return new Set([bst ? `Bst ${bst}` : 'ohne Strecke'])
}

/**
 * Satzarten 21/23 → the row shape `buildTracksFromCsv` consumes.
 *
 * An element that serves two line numbers is emitted once per number; the
 * chain builder there keys on the point-address pair and drops the repeat.
 * Cant is stored in metres and converted to millimetres here, which is the
 * unit the model and the CSV path use throughout.
 */
export function mdbRows(payload) {
  const { points, elements, cants, tracks } = payload
  const coords = pointIndex(points)
  const sectioned = streckeByElement(tracks)
  // What the sections do not mention is filed under a name of its own, and
  // written into the same index — so the cant records at those addresses end
  // up under the same name as the element they belong to.
  const byPair = new Map(sectioned)
  let loose = 0
  for (const el of elements) {
    const key = padKey(el?.pad1, el?.pad2)
    if (sectioned.has(key)) continue
    loose++
    if (!byPair.has(key)) byPair.set(key, looseStrecke(el))
  }
  const errors = []
  const rows = []
  let unplaced = 0

  for (const el of elements) {
    const typ = ELTYP_NAME[el?.typ]
    const start = coords.get(padKey(el?.pad1, el?.sys))
    if (!start) { unplaced++; continue }
    const strecken = byPair.get(padKey(el?.pad1, el?.pad2))
    if (!strecken) continue
    for (const strecke of strecken) {
      rows.push({
        typ: typ ?? `ELTYP ${el?.typ}`,
        anf: el?.pad1, end: el?.pad2,
        lsys: el?.sys, strecke,
        bearing: Number(el?.ariwi) * GON2DEG,
        length: Number(el?.p1),
        p2: Number(el?.p2), p3: Number(el?.p3),
        start,
        flagged: Number(el?.err) !== 0,
      })
    }
  }

  // Cant rows are keyed by the same address pair, so they need no line number
  // of their own — they are filtered by the elements they match.
  const cantRows = []
  for (const c of cants) {
    const strecken = byPair.get(padKey(c?.pad1, c?.pad2))
    if (!strecken) continue
    for (const strecke of strecken) {
      cantRows.push({
        typ: Number(c?.typ) === 0 ? CANT_CONSTANT : 'Rampe',
        anf: c?.pad1, end: c?.pad2, strecke,
        length: Number(c?.p1),
        // Stored in metres, and mostly as magnitudes — the sign is taken from
        // the curve the section sits in, the way the CSV path does it.
        u1: Math.abs(Number(c?.p2)) * 1000, u2: Math.abs(Number(c?.p3)) * 1000,
      })
    }
  }

  if (unplaced) {
    errors.push(`${unplaced} Elemente ohne Koordinate im eigenen Lagesystem übersprungen.`)
  }
  if (loose) {
    errors.push(`${loose} Elemente gehören zu keinem Gleisabschnitt (Satzart 33) `
      + '– gruppiert nach Trassenbezeichnung, sonst nach Betriebsstelle. '
      + 'Diese Namen stehen mit in der Streckenliste.')
  }
  return { rows, cantRows, errors }
}

function streckenOf(rows) {
  const counts = new Map()
  for (const r of rows) counts.set(r.strecke, (counts.get(r.strecke) ?? 0) + 1)
  return [...counts.entries()]
    .map(([strecke, count]) => ({ strecke, count }))
    .sort((a, b) => a.strecke.localeCompare(b.strecke, undefined, { numeric: true }))
}

/** Line numbers present, with how many elements each carries. */
export function listMdbStrecken(payload) {
  return streckenOf(mdbRows(payload).rows)
}

/**
 * Build the tracks of one line number.
 *
 * Elements are grouped by their own Lagesystem and each group is built in that
 * plane — `EA0` carries the majority of this database and forcing everything
 * into `ER0` was measured at metre-level error, so the system travels with the
 * element (ROADMAP decision 30). A track whose elements straddle both systems
 * therefore comes out as two chains and is reported rather than glued.
 *
 * Returns { tracks, errors }.
 */
export function buildTracksFromMdb(payload, strecke, opts = {}) {
  const built = mdbRows(payload)
  const vertical = verticalFor(payload)
  const res = oneStrecke({ ...built, vertical }, strecke, opts)
  return {
    tracks: res.tracks,
    errors: [...built.errors, ...res.errors, ...gradientNotes(vertical, res.tracks)],
  }
}

/**
 * The gradient of the file, ready to be cut for a track: every chain Satzart
 * 22 states, and where each point address is stationed.
 *
 * Built once per import rather than per line number — a database states one
 * gradient for the whole network, and reading it again for each of four
 * hundred line numbers would be the same work four hundred times.
 */
function verticalFor(payload) {
  const { station, line } = stationIndex(payload)
  const { chains, refused } = mdbGradientChains(payload)
  return { station, line, chains, refused, drift: 0 }
}

/**
 * The heights of the track a chain of rows becomes, or null where none fit.
 *
 * Where the track sits on the line is read from its own point addresses the
 * same way the gradient is read: the stations the file states, and the element
 * lengths between them where it states none.
 */
function heightsForChain(chain, elements, vertical) {
  if (!vertical?.chains?.length || !chain?.length) return null
  const pads = [chain[0].anf, ...chain.map(r => r.end)]
  const cum = [0]
  for (const r of chain) cum.push(cum[cum.length - 1] + (r.length ?? 0))
  const at = stationsAlong(pads, cum, vertical.station)
  const line = pads.map(pad => vertical.line.get(pad)).find(Boolean)
  if (!at || !line) return null
  const begin = at[0]
  const end = at[at.length - 1]
  const length = elements.reduce((n, el) => n + (el.length ?? 0), 0)
  const points = gradientForTrack(vertical.chains,
    { line, bst: new Set(pads.map(bstOf)), begin, end, length })
  if (points) {
    // How far the line's stationing and the track's own geometry disagree over
    // this track — reported, because it is a property of the file.
    vertical.drift = Math.max(vertical.drift, Math.abs(Math.abs(end - begin) - length))
  }
  return points
}

function gradientNotes(vertical, tracks) {
  const notes = []
  if (!vertical.chains.length && !vertical.refused) return notes
  const withHeights = tracks.filter(t => t.heights?.length).length
  notes.push(`Gradiente: ${vertical.chains.length} Höhenketten in der Datei, `
    + `${withHeights} von ${tracks.length} Gleisen bekommen eine. `
    + 'Ein Gleis bleibt ohne, wenn keine Kette seiner Strecke über seine ganze Länge reicht.')
  if (vertical.refused) {
    notes.push(`${vertical.refused} Höhenketten übersprungen – kein Punkt der Kette `
      + 'ist stationiert oder keiner trägt eine Höhe im eigenen Höhensystem.')
  }
  if (vertical.drift > 0.1) {
    notes.push(`Stationierung und Geometrie weichen um bis zu ${vertical.drift.toFixed(2)} m `
      + 'je Gleis voneinander ab – die Gradiente ist auf die Gleislänge gezogen.')
  }
  return notes
}

/**
 * Every line number in the file in one go — the whole database as tracks.
 *
 * The rows are built once and then cut per line number, which is what makes
 * this worth having: `buildTracksFromMdb` called in a loop would walk all
 * 9 218 elements again for each of the ~390 line numbers.
 */
export function buildAllTracksFromMdb(payload, opts = {}) {
  const built = mdbRows(payload)
  const vertical = verticalFor(payload)
  const tracks = []
  const errors = [...built.errors]
  for (const { strecke } of streckenOf(built.rows)) {
    const res = oneStrecke({ ...built, vertical }, strecke, opts)
    tracks.push(...res.tracks)
    errors.push(...res.errors)
  }
  return { tracks, errors: [...errors, ...gradientNotes(vertical, tracks)] }
}

function oneStrecke({ rows, cantRows, vertical }, strecke, opts = {}) {
  const errors = []
  const mine = rows.filter(r => r.strecke === String(strecke))
  if (!mine.length) {
    return { tracks: [], errors: [`Keine Elemente für Strecke ${strecke} gefunden.`] }
  }

  const bySys = new Map()
  for (const r of mine) {
    if (!bySys.has(r.lsys)) bySys.set(r.lsys, [])
    bySys.get(r.lsys).push(r)
  }

  const known = [...bySys.keys()].filter(s => epsgForLagesystem(s))
  const unknown = [...bySys.keys()].filter(s => !epsgForLagesystem(s))
  for (const s of unknown) {
    errors.push(`Lagesystem ${s} ist nicht zugeordnet – ${bySys.get(s).length} Elemente übersprungen.`)
  }
  if (!known.length) return { tracks: [], errors }   // nothing placeable in this line

  // No explicit target means no transformation: every track keeps the plane its
  // elements were surveyed in. The model holds one plane per track anyway, and
  // a bearing is grid-relative — moving it would tilt the alignment for a gain
  // that WGS 84 display does not need (ROADMAP decision 30).
  known.sort((a, b) => bySys.get(b).length - bySys.get(a).length)
  if (known.length > 1) {
    errors.push(`Strecke ${strecke} liegt in ${known.length} Lagesystemen `
      + `(${known.map(s => `${s} → EPSG ${epsgForLagesystem(s)}: ${bySys.get(s).length}`).join(', ')}) `
      + '– je System eine eigene Kette. Die Übergänge dazwischen sind Knoten: '
      + 'Weichen → Gleisenden verknüpfen.')
  }

  const flagged = mine.filter(r => r.flagged).length
  if (flagged) {
    errors.push(`${flagged} Elemente sind in der Quelle als fehlerhaft markiert (ErrStatus) `
      + '– vor dem Übernehmen prüfen.')
  }

  const tracks = []
  for (const sys of known) {
    const res = buildTracksFromCsv(bySys.get(sys), strecke, cantRows, {
      sourceEpsg: epsgForLagesystem(sys),
      targetEpsg: Number(opts.targetEpsg ?? epsgForLagesystem(sys)),
      // The vertical alignment is stated over the line, not over this chain:
      // it is cut to the piece the chain runs over once the chain is known.
      heightsFor: (chain, elements) => heightsForChain(chain, elements, vertical),
    })
    for (const t of res.tracks) tracks.push({ ...t, lagesystem: sys })
    errors.push(...res.errors.map(e => (known.length > 1 ? `[${sys}] ${e}` : e)))
  }
  // Each system numbers its chains from 1, so a line in two systems would hand
  // out `5510.001` twice. The number runs across the whole line instead.
  return {
    tracks: tracks.map((t, i) => ({ ...t, name: `${strecke}.${String(i + 1).padStart(3, '0')}` })),
    errors,
  }
}

/**
 * Satzart 31 → the switch inventory.
 *
 * A Bauteil is not a node: the source splits a Kreuzungsweiche into its switch
 * points (`…A`–`…D`), the model holds one record. Grouping is by Betriebsstelle,
 * node number without its trailing letter, **and the Bauform prefix** — without
 * the prefix a turnout `12A` and a crossing `12B` of the same Betriebsstelle
 * merge into one phantom group, which is measurable in this database (four such
 * collisions). The full Bauform text is too strict the other way: the four nodes
 * of a Kreuzungsweiche do not always spell their form identically.
 *
 * The result is an inventory, not records — a switch without `portA_trackId`
 * and without carved routes is none in the model's sense. It becomes one when
 * the alignment is there and it can be placed on a track.
 */
export function mdbSwitchInventory(payload) {
  const errors = []
  const groups = new Map()

  for (const n of payload.nodes) {
    const typ = Number(n?.typ)
    if (typ !== KNTYP_SWITCH && typ !== KNTYP_CROSSING) continue
    const { bst, nr } = splitKnoten(n?.knoten)
    const form = parseBauform(n?.form)
    const suffix = /[A-Z]$/.test(nr) ? nr.slice(-1) : null
    const base = suffix ? nr.slice(0, -1) : nr
    const key = `${bst}\u0000${base}\u0000${form.prefix ?? ''}`
    let g = groups.get(key)
    if (!g) { g = { bst, nr: base, typ, members: [], form }; groups.set(key, g) }
    g.members.push({ ...n, suffix, pad: n?.pad, neighbours: (n?.nb ?? []).filter(Boolean) })
  }

  const units = []
  for (const g of groups.values()) {
    const { form } = g
    // A form without a prefix still names a switch: a lone node of Satzart 31
    // can only be a turnout or a crossing, because the multi-node kinds are
    // recognised by their group. That is an inference, so it is reported.
    let kind = form.kind
    if (!kind) {
      if (g.members.length > 1) {
        errors.push(`${g.bst}/${g.nr}: Bauform nicht erkannt – „${form.raw || '(leer)'}“`)
        continue
      }
      kind = g.typ === KNTYP_CROSSING ? 'crossing' : 'turnout'
      errors.push(`${g.bst}/${g.nr}: Bauform ohne Kennbuchstaben („${form.raw || '(leer)'}“) – `
        + `als ${kind === 'crossing' ? 'Kreuzung' : 'Weiche'} übernommen (Knotentyp ${g.typ}).`)
    }
    const want = KIND_BY_PREFIX[form.prefix]?.nodes ?? 1
    if (g.members.length !== want) {
      errors.push(`${g.bst}/${g.nr} (${form.raw}): ${g.members.length} Knoten, erwartet ${want} `
        + '– unvollständige Gruppe, nicht übernommen.')
      continue
    }
    if (form.radius == null && kind !== 'crossing') {
      errors.push(`${g.bst}/${g.nr} (${form.raw}): kein Radius in der Bauform.`)
    }
    if (form.n == null) {
      errors.push(`${g.bst}/${g.nr} (${form.raw}): keine Neigung in der Bauform.`)
    }
    const lead = g.members.find(m => !m.suffix || m.suffix === 'A') ?? g.members[0]
    units.push({
      pad: lead.pad,
      bst: g.bst,
      name: g.nr,
      number: Number.parseInt(g.nr, 10) || null,
      kind,
      label: form.raw,
      radius: form.radius,
      slope: form.n,
      rail: RAIL_NAME[form.rail] ?? null,
      pads: g.members.map(m => m.pad),
      // Which node is which corner: the crossing kinds run their routes A–C and
      // B–D (see SWITCH_ROUTES), so the placement needs them apart.
      padBySuffix: Object.fromEntries(g.members.filter(m => m.suffix).map(m => [m.suffix, m.pad])),
      flagged: g.members.some(m => Number(m.err) !== 0),
    })
  }

  const dup = new Map()
  for (const u of units) dup.set(u.pad, (dup.get(u.pad) ?? 0) + 1)
  for (const [pad, n] of dup) {
    if (n > 1) errors.push(`Punktadresse ${pad} kommt ${n}-mal vor – Identität nicht eindeutig.`)
  }

  units.sort((a, b) => a.bst.localeCompare(b.bst) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { units, errors }
}
