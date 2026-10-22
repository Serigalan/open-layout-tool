import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { storedTrackCants } from '../utils/geometry/clothoidUtils'

/**
 * The PEK data set Halle–Könnern (22 tracks, 13 switches, 9 platforms) — real
 * planning data from outside, kept out of the repository. Tests that need it
 * look for it under OLT_PEK_FIXTURE or the project notes and are skipped where
 * it is not there.
 *
 * The file is from before this tool's own format; it is brought to the
 * oltjson-1.1 record the way an import would need it: every switch a
 * `switchId`, `kind`, `formVersion` and its `ports`, every switch element the
 * id of the switch its `switchName` names — and no name of its own after that
 * —, every transition both its cant ends, which it took from its neighbours.
 */
const CANDIDATES = [
  process.env.OLT_PEK_FIXTURE,
  join(homedir(), '.claude/projects/-root-open-layout-tool/memory/testdata/PEK_Halle_Koennern_Vorlage.json'),
].filter(Boolean)

const PATH = CANDIDATES.find(p => existsSync(p)) ?? null

export const hasPek = PATH !== null

let cached = null

/** A fresh copy of the converted project record (dehydrated), or null. */
export function loadPek() {
  if (!PATH) return null
  if (!cached) {
    const data = JSON.parse(readFileSync(PATH, 'utf8'))
    const project = data.projects[1]
    const ids = new Map()
    let n = 0
    for (const sw of project.switches ?? []) {
      sw.switchId = sw.switchId ?? `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      sw.kind = sw.kind ?? 'turnout'
      sw.formVersion = sw.formVersion ?? 1
      ids.set(sw.name, sw.switchId)
      const ports = {}
      for (const key of Object.keys(sw)) {
        const m = key.match(/^port(A|B1|B2|B|C|D)_(trackId|endpoint)$/)
        if (!m) continue
        ports[m[1]] = { ...ports[m[1]], [m[2]]: sw[key] }
        delete sw[key]
      }
      sw.ports = ports
    }
    for (const track of project.tracks ?? []) {
      for (const el of track.elements ?? []) {
        if (el.switchBranch && !el.switchId) el.switchId = ids.get(el.switchName)
        delete el.switchName
        delete el.switchLabel
        delete el.absLength
      }
      track.elements = storedTrackCants(track.elements ?? [])
    }
    cached = JSON.stringify(project)
  }
  return JSON.parse(cached)
}

/**
 * The same line as it stands, at larger scale (113 tracks, 69 switches, two
 * double-track networks with crossovers) — an oltjson-1.1 file, as the app
 * exports it. Looked for under OLT_PEK_BESTAND_FIXTURE or the project
 * notes; tests that need it are skipped where it is not there.
 */
const BESTAND_PATH = [
  process.env.OLT_PEK_BESTAND_FIXTURE,
  join(homedir(), '.claude/projects/-root-open-layout-tool/memory/testdata/PEK_Halle_Koennern_Bestand.json'),
].filter(Boolean).find(p => existsSync(p)) ?? null

export const hasPekBestand = BESTAND_PATH !== null

/** A fresh copy of the Bestand project record (dehydrated), or null. */
export function loadPekBestand() {
  if (!BESTAND_PATH) return null
  return JSON.parse(readFileSync(BESTAND_PATH, 'utf8')).projects[0]
}
