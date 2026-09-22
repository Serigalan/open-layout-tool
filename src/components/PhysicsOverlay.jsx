import { flattenPhysics, PHYSICS } from '../utils/constraintsView'
import FormelMathml from './FormelMathml'

/**
 * The physics beneath the optimizer, read-only, in the same popup shell the
 * track editor uses. Bundled from the repo file at build time (see
 * constraintsView.js) rather than fetched: physics.json is one of the repo's
 * own constraint files, and it drives nothing at runtime anyway — there is
 * nothing live to ask for.
 */
export default function PhysicsOverlay({ t, onClose }) {
  const { konstanten, profile } = flattenPhysics(PHYSICS)

  // "-" is how the file says a value has no unit (a ramp factor, the cant
  // deficiency coefficient) — it is not one, so it is not printed as one.
  const einheitText = (einheit) => (einheit && einheit !== '-' ? ` ${einheit}` : '')

  return (
    <div className="track-table-overlay constraints-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {t('constraints_physics')}
          <span className="track-table-subtitle">{t('constraints_readonly')}</span>
        </span>
        <button className="track-table-close" onClick={onClose}>✕</button>
      </div>

      <div className="track-table-scroll constraints-scroll">
        <p className="constraints-hint">{t('constraints_physics_hint')}</p>
        <table className="track-table constraints-table">
          <thead>
            <tr>
              <th>{t('optimize_regelwerk_wert')}</th>
              <th>{t('optimize_regelwerk_warum')}</th>
              <th>{t('optimize_regelwerk_wo')}</th>
            </tr>
          </thead>
          <tbody>
            {konstanten.map(row => (
              <tr key={row.path}>
                <td className="constraints-value">
                  {String(row.wert)}{einheitText(row.einheit)}
                </td>
                <td>
                  {row.warum}
                  {/* The formula the constant stands in, and the arithmetic it
                      comes out of — the reason the file exists at all. */}
                  <FormelMathml mathml={row.formelMathml} />
                  {row.herleitung && <span className="constraints-note">{row.herleitung}</span>}
                </td>
                <td className="constraints-where">{row.woVerwendet}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="constraints-subsection">{t('constraints_profiles')}</h4>
        <table className="track-table constraints-table">
          <thead>
            <tr>
              <th>{t('constraints_name')}</th>
              <th>{t('constraints_curvature')}</th>
              <th>{t('optimize_regelwerk_warum')}</th>
            </tr>
          </thead>
          <tbody>
            {profile.map(p => (
              <tr key={p.key}>
                <td className="constraints-value">{p.name}</td>
                <td>
                  {p.kruemmung}
                  <FormelMathml mathml={p.kruemmungMathml} />
                </td>
                <td>{p.warum}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
