import { useEffect, useState } from 'react'
import { fetchRegelwerke, fetchRegelwerk } from '../utils/optimizerService'
import { flattenRegelwerk } from '../utils/regelwerkView'
import { flattenPhysics, appValueFor, PHYSICS } from '../utils/constraintsView'

/**
 * The constraints a run is held to, in one popup: the regelwerk (the values a
 * railway administration sets) and the physics beneath it. Read-only — these
 * are maintained in the repo, where the drift checks can see them
 * (tests/verify.py, regelwerkDefaults.test.js); a field here that wrote
 * anywhere would put a number in front of the user that no check ever reads.
 *
 * The two halves come from different places on purpose. The regelwerk is
 * fetched live from the service, because that is the copy a run is actually
 * held to — an app built from a newer commit than the deployed service would
 * otherwise show limits nobody's run uses. Physics is bundled from the repo
 * file (see constraintsView.js): the service cannot serve it, and it drives
 * nothing at runtime, so there is nothing live to ask for.
 */
/**
 * The set formula, drawn by the browser's own MathML — no library, MathML
 * Core renders in every current browser. physics.json states each formula
 * twice: this markup for drawing, and a bare `*_calc` expression a test
 * evaluates against the kernel (constraintsView.test.js,
 * tests/verify.py) — the calc side is never shown, only checked.
 *
 * The markup comes from this repo's own physics.json, never from anything a
 * user typed or a service answered — which is what makes setting it as markup
 * safe here, and why the popup does not do the same anywhere else.
 */
function Formel({ mathml }) {
  if (!mathml) return null
  return <span className="constraints-math" dangerouslySetInnerHTML={{ __html: mathml }} />
}

export default function ConstraintsOverlay({ t, regelwerkId, onClose }) {
  // null while the list is still being asked for, [] once the service has
  // answered with nothing — the two read the same in a table but not to the
  // reader, who is told either "loading" or "no server".
  const [regelwerke, setRegelwerke] = useState(null)
  const [wanted, setWanted] = useState(regelwerkId ?? '')
  // Keyed by id, and only ever written from the fetch callback — never
  // synchronously in the effect body — so a change of id does not need its own
  // reset: stale content for a previous id is simply not `current` and reads
  // as still loading until its own fetch answers.
  const [status, setStatus] = useState(null)   // { id, regelwerk } | { id, failed: true }

  useEffect(() => {
    let cancelled = false
    fetchRegelwerke().then(list => {
      if (!cancelled) setRegelwerke(list)
    })
    return () => { cancelled = true }
  }, [])

  const id = wanted || regelwerke?.[0]?.id || ''

  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetchRegelwerk(id).then(rw => {
      if (cancelled) return
      setStatus(rw ? { id, regelwerk: rw } : { id, failed: true })
    })
    return () => { cancelled = true }
  }, [id])

  const current = status?.id === id ? status : null
  const regelwerk = current?.regelwerk ?? null
  const failed = !!current?.failed
  const rows = regelwerk ? flattenRegelwerk(regelwerk) : []
  const { konstanten, profile } = flattenPhysics(PHYSICS)

  // A boolean limit ("does existing track fall under the ramp rule") reads as
  // a sentence, not as `false`; numbers keep the shape the JSON states them in.
  const wertText = (wert) =>
    typeof wert === 'boolean' ? t(wert ? 'constraints_yes' : 'constraints_no') : String(wert)

  // "-" is how the files say a value has no unit (a ramp factor, the cant
  // deficiency coefficient) — it is not one, so it is not printed as one.
  const einheitText = (einheit) => (einheit && einheit !== '-' ? ` ${einheit}` : '')

  return (
    <div className="track-table-overlay constraints-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {t('constraints_title')}
          <span className="track-table-subtitle">{t('constraints_readonly')}</span>
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* A selector only where there is something to select — today the
              service knows exactly one regelwerk. */}
          {(regelwerke?.length ?? 0) > 1 && (
            <select className="track-table-input track-table-input-wide"
              value={id} onChange={e => setWanted(e.target.value)}>
              {regelwerke.map(rw => <option key={rw.id} value={rw.id}>{rw.name}</option>)}
            </select>
          )}
          <button className="track-table-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="track-table-scroll constraints-scroll">
        <h3 className="constraints-section">{t('constraints_regelwerk')}</h3>
        {/* Three states, said apart: still asking, asked and no server, and
            the table itself. A panel that needs the service says so rather
            than showing an empty table. */}
        {!failed && !regelwerk && (regelwerke === null || id) && (
          <p className="constraints-hint">{t('constraints_loading')}</p>
        )}
        {(failed || (regelwerke?.length === 0 && !id)) && (
          <p className="constraints-error">{t('optimize_err_unavailable')}</p>
        )}
        {regelwerk && (
          <>
            <p className="constraints-hint">
              {regelwerk.name} · v{regelwerk.version} · {t('optimize_regelwerk_gueltig_ab')}{' '}
              {regelwerk.gueltigAb ?? regelwerk.gueltig_ab}
            </p>
            <table className="track-table constraints-table">
              <thead>
                <tr>
                  <th>{t('optimize_regelwerk_wert')}</th>
                  <th>{t('optimize_regelwerk_warum')}</th>
                  <th>{t('optimize_regelwerk_wo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  // Only a value the app really holds itself says so, and only
                  // there can the two disagree — a service deployed from an
                  // older commit than this bundle. The drift test on disk
                  // cannot see that one; this line can.
                  const app = appValueFor(row.path)
                  const mismatch = app !== null && app !== row.wert
                  return (
                    <tr key={row.path}>
                      <td className="constraints-value">
                        {wertText(row.wert)}{einheitText(row.einheit)}
                        {app !== null && (
                          <span className={mismatch ? 'constraints-app-mismatch' : 'constraints-note'}>
                            {mismatch
                              ? `${t('constraints_app_mismatch')}: ${app}${einheitText(row.einheit)}`
                              : t('constraints_app')}
                          </span>
                        )}
                      </td>
                      <td>{row.warum}</td>
                      <td className="constraints-where">{row.woVerwendet}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        <h3 className="constraints-section">{t('constraints_physics')}</h3>
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
                  <Formel mathml={row.formelMathml} />
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
                  <Formel mathml={p.kruemmungMathml} />
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
