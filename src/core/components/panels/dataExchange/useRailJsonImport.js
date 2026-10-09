import { useState } from 'react'
import { commitImport, loadEndMarks, loadTracks } from '../../../storage'
import { parseOsrdRailJson } from '../../../utils/osrdImport'
import { planRailJsonImport } from '../../../utils/import/railJsonImport'
import { fitToTracks } from '../../../utils/mapRenderUtils'
import { readFileText } from '../../../utils/fileUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useMap } from '../../../map/MapContext'

/**
 * Reading a RailJSON or alignment exchange file into the project (osrdImport):
 * the geometry comes from horizontal_alignment, the heights from
 * vertical_alignment. Tracks already present are not replaced — the imported
 * ones take a fresh id. What the app does not model is kept, so an export
 * hands it back. One commit, one undo step.
 */
export default function useRailJsonImport() {
  const { t } = useI18n()
  const map = useMap()
  const [errors, setErrors] = useState([])

  const importFile = async (file) => {
    setErrors([])
    try {
      const parsed = parseOsrdRailJson(JSON.parse(await readFileText(file)))
      setErrors(parsed.errors)
      if (!parsed.tracks.length) return
      const { osrd, ...commit } = planRailJsonImport(parsed, { existingTracks: loadTracks(), existingMarks: loadEndMarks() })
      commitImport({ ...commit, patch: { osrd } })
      // The import usually lands far outside the current view — show it.
      fitToTracks(map?.current, commit.addTracks)
    } catch (err) {
      setErrors([`${t('import_parse_error')}: ${err.message}`])
    }
  }

  return { errors, importFile }
}
