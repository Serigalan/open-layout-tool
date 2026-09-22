import { useEffect, useState } from 'react'
import { fetchRegelwerke, fetchRegelwerk } from '../utils/optimizerService'
import { flattenRegelwerk } from '../utils/regelwerkView'
import { appValueFor } from '../utils/constraintsView'

/**
 * The regelwerk a run is held to — the values a railway administration sets —
 * read-only, in the same popup shell the track editor uses. Fetched live from
 * the service rather than bundled: this is the copy a run is actually
 * measured against, and an app built from a newer commit than the deployed
 * service would otherwise show limits nobody's run uses.
 *
 * `flattenRegelwerk` (AP R.5) does the flattening; this is only the rendering
 * and the fetch, unchanged in substance from the RegelwerkView it replaces —
 * still open from the optimizer panel's "show regelwerk" link, now also from
 * the edit panel's own Regelwerk button.
 */
export default function RegelwerkOverlay({ t, regelwerkId, onClose }) {
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

  // A boolean limit ("does existing track fall under the ramp rule") reads as
  // a sentence, not as `false`; numbers keep the shape the JSON states them in.
  const wertText = (wert) =>
    typeof wert === 'boolean' ? t(wert ? 'constraints_yes' : 'constraints_no') : String(wert)

  // "-" is how the file says a value has no unit — it is not one, so it is
  // not printed as one.
  const einheitText = (einheit) => (einheit && einheit !== '-' ? ` ${einheit}` : '')

  return (
    <div className="track-table-overlay constraints-overlay">
      <div className="track-table-header">
        <span className="track-table-title">
          {t('constraints_regelwerk')}
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
      </div>
    </div>
  )
}
