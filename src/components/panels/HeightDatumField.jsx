import { HEIGHT_DATUMS } from '../../utils/mapConstants'

/**
 * Height datum of a track, shown with the geometry data next to the horizontal
 * CRS – both say which reference system the stated numbers belong to.
 */
export default function HeightDatumField({ t, value, onChange }) {
  // A datum from an import the list does not know is shown as it is.
  const datums = HEIGHT_DATUMS.some(d => String(d.epsg) === String(value))
    ? HEIGHT_DATUMS
    : [...HEIGHT_DATUMS, { epsg: Number(value), label: '' }]

  return (
    <div className="form-field">
      <label>{t('height_datum')}</label>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {datums.map((d) => (
          <option key={d.epsg} value={String(d.epsg)}>{`EPSG ${d.epsg}${d.label ? ` – ${d.label}` : ''}`}</option>
        ))}
      </select>
    </div>
  )
}
