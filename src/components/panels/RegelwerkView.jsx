import { useEffect, useState } from 'react'
import { fetchRegelwerk } from '../../utils/optimizerService'
import { flattenRegelwerk } from '../../utils/regelwerkView'
import { BackIcon } from '../icons'

/**
 * AP R.5, stage 1 ("zeigend"): the regelwerk a run is held to, as a table —
 * value, unit, source, why, where it is used. Nothing here is computed; it is
 * exactly what GET /regelwerke/<id> answered, run through flattenRegelwerk
 * (a pure function, tested on its own in regelwerkView.test.js without a
 * DOM). Stage 2 ("rechnend" — the consequence of each limit for the current
 * input, with AP R.4's bindender Grund linked in) is not built yet.
 */
export default function RegelwerkView({ t, id, onBack }) {
  // Keyed by id, and only ever written from the fetch callback — never
  // synchronously in the effect body — so a change of id does not need its
  // own reset: stale content for a previous id is simply not `current` and
  // reads as still loading until its own fetch answers.
  const [status, setStatus] = useState(null)   // { id, regelwerk } | { id, failed: true }

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

  return (
    <>
      <button className="back-btn" onClick={onBack}>
        <BackIcon />
        {t('btn_back')}
      </button>
      <h2>{t('optimize_regelwerk')}</h2>
      {!id && <p style={{ fontSize: 12, color: '#e74c3c' }}>{t('optimize_err_unavailable')}</p>}
      {id && failed && <p style={{ fontSize: 12, color: '#e74c3c' }}>{t('optimize_err_unavailable')}</p>}
      {id && !failed && !regelwerk && <p style={{ fontSize: 12, color: '#5b9bd5' }}>{t('optimize_running')}</p>}
      {regelwerk && (
        <>
          <p style={{ fontSize: 12, color: '#888' }}>
            {regelwerk.name} · v{regelwerk.version} · {t('optimize_regelwerk_gueltig_ab')} {regelwerk.gueltigAb ?? regelwerk.gueltig_ab}
          </p>
          <table style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>{t('optimize_regelwerk_wert')}</th>
                <th>{t('optimize_regelwerk_warum')}</th>
                <th>{t('optimize_regelwerk_wo')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.path} style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
                  <td style={{ padding: '4px 4px 4px 0', whiteSpace: 'nowrap' }}>
                    {String(row.wert)}{row.einheit ? ` ${row.einheit}` : ''}
                  </td>
                  <td style={{ padding: '4px' }}>{row.warum}</td>
                  <td style={{ padding: '4px 0 4px 4px', color: '#888' }}>{row.woVerwendet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}
