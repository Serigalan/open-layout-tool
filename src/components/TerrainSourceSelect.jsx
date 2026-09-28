import { saveSettings } from '../storage'
import { TERRAIN_SOURCES } from '../utils/elevationSource'

/**
 * Which height data the terrain is read from: automatically the best there is
 * (the Länder's DGM1, then DGM5, then MapTiler), or one of them outright. The
 * choice is the user's, kept with the other settings, so the cross section and
 * the gradient read from the same source (chosenTerrainSource).
 */
export default function TerrainSourceSelect({ t, value, onChange, className = 'settings-select' }) {
  return (
    <select className={className} value={value} title={t('terrain_source_hint')}
      onChange={e => { saveSettings({ terrainSource: e.target.value }); onChange?.(e.target.value) }}>
      {TERRAIN_SOURCES.map(s => <option key={s} value={s}>{t(`terrain_source_${s}`)}</option>)}
    </select>
  )
}
