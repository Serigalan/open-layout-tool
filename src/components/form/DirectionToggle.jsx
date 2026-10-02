/**
 * Two words and a switch between them (R4.3) — facing/trailing, with/against
 * the track direction. `value` false is the left word, true the right one.
 */
export default function DirectionToggle({ value, onChange, left, right }) {
  return (
    <div className="toggle-switch-wrap">
      <span className={`toggle-label${!value ? ' active' : ''}`}>{left}</span>
      <label className="toggle-switch">
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
      <span className={`toggle-label${value ? ' active' : ''}`}>{right}</span>
    </div>
  )
}
