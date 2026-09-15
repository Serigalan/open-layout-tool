/**
 * Shared component: displays UTM easting / northing fields
 * with optional editing support.
 */
export default function UtmCoordFields({ label, zone, easting, northing, onChange, readOnly }) {
  return (
    <div className="form-field">
      <label>{label}{zone ? ` (EPSG:${zone})` : ''}</label>
      <div className="coord-row">
        <span className="coord-prefix">E:</span>
        <input type="number" step="0.01" readOnly={readOnly} value={easting}
          onChange={onChange ? (e) => onChange('e', e.target.value) : undefined} />
      </div>
      <div className="coord-row">
        <span className="coord-prefix">N:</span>
        <input type="number" step="0.01" readOnly={readOnly} value={northing}
          onChange={onChange ? (e) => onChange('n', e.target.value) : undefined} />
      </div>
    </div>
  )
}
