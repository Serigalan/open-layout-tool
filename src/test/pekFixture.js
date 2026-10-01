import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The PEK data set Halle–Könnern (22 tracks, 13 switches, 9 platforms) — real
 * planning data from outside, kept out of the repository. Tests that need it
 * look for it under OLT_PEK_FIXTURE or the project notes and are skipped where
 * it is not there.
 *
 * The file is schema version 1; it is brought to version 2 the way an import
 * would need it: every switch a `switchId`, `kind` and `formVersion`, every
 * switch element the id of the switch its `switchName` names.
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
    }
    for (const track of project.tracks ?? []) {
      for (const el of track.elements ?? []) {
        if (el.switchBranch && !el.switchId) el.switchId = ids.get(el.switchName)
      }
    }
    cached = JSON.stringify(project)
  }
  return JSON.parse(cached)
}
