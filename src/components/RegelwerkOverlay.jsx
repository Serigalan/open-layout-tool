import { useEffect, useState } from 'react'
import { fetchRegelwerke, fetchRegelwerk } from '../utils/optimizerService'
import { BUNDLED_KATALOG_VERSION, GRENZWERTE, optimizerLimitRows } from '../utils/constraintsView'
import { WEICHEN_REGELWERK } from '../utils/weichenRegelwerk'
import { CATALOG_ID, KATALOG } from '../utils/regelkatalog'
import WeichenRegelwerk from './WeichenRegelwerk'
import QuerschnittRegelwerk from './QuerschnittRegelwerk'
import { QUERSCHNITT_KATALOG } from '../utils/gaugeProfiles'
import RegelkatalogView from './RegelkatalogView'

/**
 * The regelwerke a layout is held to, read-only, in the same popup shell the
 * track editor uses. A selector beside the heading names them; the page below
 * is whichever one is chosen.
 *
 * **One rulebook is one entry**, however many faces it has. DB Ril 800.0110 is
 * the rules the app bundles (`regelkatalog.js`) and the very file the optimizer
 * applies — so it is listed once, the rules first, and under them the limits
 * the service says a run is held to at Regelwert and Ermessensgrenze. Those
 * are still fetched rather than read out of the rules: a service deployed
 * from an older commit than this bundle runs on its own copy of the file, and
 * that is the copy a run really uses.
 *
 * Bundled rulebooks come first and are always there; anything else the service
 * lists is appended, so a regelwerk added to the service later shows up here
 * without a change to this file.
 */

const BUNDLED_IDS = [CATALOG_ID, WEICHEN_REGELWERK.id, QUERSCHNITT_KATALOG.katalog.id]

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

  // The bundled rulebooks say their own name through the app, in whichever
  // language it is asked in (regelwerk_title_<id>) — the way every other name
  // a catalogue states about itself is spoken (see switchKindLabelKey). A
  // served rulebook has no such key and is named as the service states it.
  const alle = [
    ...BUNDLED_IDS.map(id => ({ id, name: t(`regelwerk_title_${id}`) })),
    ...(regelwerke ?? [])
      .filter(rw => !BUNDLED_IDS.includes(rw.id))
      .map(rw => ({ id: rw.id, name: rw.name })),
  ]
  const id = wanted || CATALOG_ID
  // Only what the service actually lists is asked for — a purely bundled
  // rulebook has nothing to fetch, and a fetch for it would only ever fail.
  const served = !!regelwerke?.some(rw => rw.id === id)

  useEffect(() => {
    if (!id || !served) return
    let cancelled = false
    fetchRegelwerk(id).then(rw => {
      if (cancelled) return
      setStatus(rw ? { id, regelwerk: rw } : { id, failed: true })
    })
    return () => { cancelled = true }
  }, [id, served])

  const current = status?.id === id ? status : null
  const regelwerk = current?.regelwerk ?? null
  const failed = !!current?.failed
  const bundled = BUNDLED_IDS.includes(id)

  // A limit is a number, a range, a list of steps, the transition forms a run
  // may hand out, or the worst severity it may produce — each read as itself.
  const limitText = (row, value) => {
    if (value === null || value === undefined) return '—'
    if (row.kind === 'forms') return value.map(form => t(`transition_type_${form}`)).join(', ') || '—'
    if (row.kind === 'severity') return t(`rule_sev_${value}`)
    const text = Array.isArray(value) ? value.join(row.join) : String(value)
    return row.unit ? `${text} ${row.unit}` : text
  }

  return (
    <div className="track-table-overlay constraints-overlay">
      <div className="track-table-header">
        <span className="track-table-title constraints-title">
          {t('constraints_regelwerk')}
          {/* Beside the heading, not out by the close button: it says which
              regelwerk the heading is about, so it belongs to the heading. */}
          <select className="track-table-input constraints-select"
            value={id} onChange={e => setWanted(e.target.value)}>
            {alle.map(rw => <option key={rw.id} value={rw.id}>{rw.name}</option>)}
          </select>
          <span className="track-table-subtitle">{t('constraints_readonly')}</span>
        </span>
        <button className="track-table-close" onClick={onClose}>✕</button>
      </div>

      <div className="track-table-scroll constraints-scroll">
        {/* A service that cannot be asked is said once, above whatever is
            shown: the bundled rules are still there and still true, and the
            reader has to know that the values half is missing rather than
            gone. */}
        {regelwerke?.length === 0 && (
          <p className="constraints-error">{t('constraints_service_down')}</p>
        )}

        {id === CATALOG_ID && <RegelkatalogView t={t} />}
        {id === WEICHEN_REGELWERK.id && <WeichenRegelwerk t={t} />}
        {id === QUERSCHNITT_KATALOG.katalog.id && <QuerschnittRegelwerk t={t} />}

        {/* Three states, said apart: still asking, asked and no server, and
            the table itself. A panel that needs the service says so rather
            than showing an empty table. */}
        {served && !failed && !regelwerk && (
          <p className="constraints-hint">{t('constraints_loading')}</p>
        )}
        {failed && <p className="constraints-error">{t('optimize_err_unavailable')}</p>}
        {!bundled && !served && regelwerke !== null && (
          <p className="constraints-error">{t('optimize_err_unavailable')}</p>
        )}

        {regelwerk && (
          <>
            {/* Under the rules: what the optimizer says it runs at under them,
                per level, beside the app's own reading of the same file. */}
            <h4 className="constraints-subsection">{t('constraints_optimizer_values')}</h4>
            <p className="constraints-hint">
              {regelwerk.name} · {t('constraints_katalog_revision')} {regelwerk.version}
            </p>
            {regelwerk.version !== BUNDLED_KATALOG_VERSION && (
              <p className="constraints-error">
                {t('constraints_version_mismatch')
                  .replace('{{served}}', regelwerk.version)
                  .replace('{{bundled}}', BUNDLED_KATALOG_VERSION)}
              </p>
            )}
            <table className="track-table constraints-table">
              <thead>
                <tr>
                  <th />
                  <th>{t('optimize_grenzwert_reg')}</th>
                  <th>{t('optimize_grenzwert_discretion')}</th>
                </tr>
              </thead>
              <tbody>
                {optimizerLimitRows(regelwerk).map(row => (
                  <tr key={row.label}>
                    <td>{t(row.label)}</td>
                    {Object.keys(GRENZWERTE).map(level => {
                      const cell = row[level]
                      return (
                        <td key={level} className="constraints-value">
                          {limitText(row, cell.served ?? cell.app)}
                          {/* Only where the two disagree — a service deployed
                              from another commit than this bundle. */}
                          {cell.mismatch && (
                            <span className="constraints-app-mismatch">
                              {t('constraints_app_mismatch')}: {limitText(row, cell.app)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
