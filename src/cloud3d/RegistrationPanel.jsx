import { useI18n } from '../locales/i18nContext'
import { formatDate, tOr } from '../locales/i18n'
import { downloadText, downloadBlob } from '../utils/fileUtils'
import { PARAMETER_UNITS, protocolCsv, protocolPdf } from './registrationReport'

const mm = (v) => (v == null ? '–' : (v * 1000).toFixed(1))

/**
 * The panel "Neu referenzieren" of the 3D window (AP 13.14): the two clouds,
 * the parameters, the pairs with their residuals, the solution, taking it
 * over, the history and the protocol. Everything that changes the cloud is
 * the admin's and the right holders' (decision 203); the others see the
 * history only.
 */
export default function RegistrationPanel({ reg, rows, mayEdit, projectTitle, heightName, userName }) {
  const { t, fill, language } = useI18n()
  const { session, refRow, adjRow, solution, pairs } = reg
  const names = Object.fromEntries(Object.keys(PARAMETER_UNITS).map(p => [p, t(`cloud3d_reg_param_${p}`)]))

  const meta = () => ({
    project: projectTitle, cloud: adjRow.name, reference: refRow.name, crs: reg.refPlane, heightName,
    person: userName, date: formatDate(new Date(), language, { time: true }), options: reg.options,
  })
  const base = () => `neureferenzierung_${adjRow.name.replace(/[^\w.-]+/g, '_')}`
  const exportCsv = () => downloadText(protocolCsv({ solution, pairs, names, ...meta() }), `${base()}.csv`, 'text/csv')
  const exportPdf = async () => downloadBlob(await protocolPdf({ solution, pairs, names, ...meta() }), `${base()}.pdf`)

  const choose = (refId, adjId) => reg.begin(refId, adjId)

  return (
    <>
      <h2>{t('cloud3d_reg_title')}</h2>
      {!mayEdit && <p className="cloud3d-hint">{t('cloud3d_reg_view_only')}</p>}
      <label className="cloud3d-field">
        <span>{t('cloud3d_reg_reference')}</span>
        <select value={session?.refId ?? ''} disabled={!mayEdit}
          onChange={e => choose(e.target.value, session?.adjId ?? '')}>
          <option value="">{t('cloud3d_reg_choose')}</option>
          {rows.filter(r => r.crs != null || r.transform).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="cloud3d-field">
        <span>{t('cloud3d_reg_adjust')}</span>
        <select value={session?.adjId ?? ''} disabled={!mayEdit}
          onChange={e => choose(session?.refId ?? '', e.target.value)}>
          <option value="">{t('cloud3d_reg_choose')}</option>
          {rows.map(r => (
            <option key={r.id} value={r.id}>
              {r.name + (r.crs == null ? ` · ${t('cloud3d_reg_local')}` : '') + (r.transform ? ` · ${t('cloud3d_reg_has_t')}` : '')}
            </option>
          ))}
        </select>
      </label>

      {session && refRow && adjRow && (
        <>
          <label className="cloud3d-check">
            <input type="checkbox" checked={reg.options.tilts} disabled={!mayEdit}
              onChange={e => reg.setOptions(o => ({ ...o, tilts: e.target.checked }))} />
            <span>{t('cloud3d_reg_tilts')}</span>
          </label>
          <label className="cloud3d-check">
            <input type="checkbox" checked={reg.options.scale} disabled={!mayEdit}
              onChange={e => reg.setOptions(o => ({ ...o, scale: e.target.checked }))} />
            <span>{t('cloud3d_reg_scale')}</span>
          </label>
          <label className="cloud3d-check">
            <input type="checkbox" checked={reg.picking} disabled={!mayEdit} onChange={e => reg.setPicking(e.target.checked)} />
            <span>{t('cloud3d_reg_pick')}</span>
          </label>
          <p className="cloud3d-hint">{t('cloud3d_reg_pick_hint')}</p>
          {reg.pending && (
            <p className="cloud3d-warn">
              {fill('cloud3d_reg_pending', { first: reg.pending.side === 'ref' ? refRow.name : adjRow.name, second: reg.pending.side === 'ref' ? adjRow.name : refRow.name })}
              {' '}<button type="button" className="cloud3d-link" onClick={reg.clearPending}>{t('btn_cancel')}</button>
            </p>
          )}
          <label className="cloud3d-check">
            <input type="checkbox" checked={reg.split} onChange={e => reg.setSplit(e.target.checked)} />
            <span>{t('cloud3d_reg_split')}</span>
          </label>

          {pairs.length > 0 && (
            <table className="cloud3d-pairs">
              <thead>
                <tr>
                  <th>{t('cloud3d_reg_nr')}</th><th>{t('cloud3d_reg_label')}</th><th>{t('cloud3d_reg_kind')}</th>
                  <th>{t('cloud3d_reg_across')}</th><th>{t('cloud3d_reg_along')}</th><th>{t('cloud3d_reg_height')}</th><th>{t('cloud3d_reg_on')}</th><th />
                </tr>
              </thead>
              <tbody>
                {pairs.map((p, k) => {
                  const r = solution?.ok && p.on !== false ? solution.residuals.find(x => x.id === p.id) : null
                  return (
                    <tr key={p.id} className={r?.suspect ? 'suspect' : p.on === false ? 'off' : ''}
                      title={r?.w != null ? fill('cloud3d_reg_w', { w: r.w.toFixed(2) }) : undefined}>
                      <td>{k + 1}</td>
                      <td>
                        <input type="text" value={p.label} placeholder={p.id} disabled={!mayEdit}
                          onChange={e => reg.update(p.id, { label: e.target.value })} />
                      </td>
                      <td>{t(p.kind === 'section' ? 'cloud3d_reg_kind_section' : 'cloud3d_reg_kind_3d')}</td>
                      <td>{mm(r?.across)}</td>
                      <td>{r?.along == null ? '–' : mm(r.along)}</td>
                      <td>{mm(r?.height)}</td>
                      <td>
                        <input type="checkbox" checked={p.on !== false} disabled={!mayEdit}
                          onChange={e => reg.update(p.id, { on: e.target.checked })} />
                      </td>
                      <td>
                        {mayEdit && <button type="button" className="cloud3d-link" aria-label={t('btn_remove')} onClick={() => reg.remove(p.id)}>✕</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {pairs.length > 0 && !solution?.ok && solution && (
            <p className="cloud3d-warn">{fill(`cloud3d_reg_reason_${solution.reason}`, { equations: solution.equations, unknowns: solution.unknowns })}</p>
          )}
          {!pairs.length && <p className="cloud3d-hint">{t('cloud3d_reg_no_pairs')}</p>}
          {solution?.ok && (
            <>
              <ul className="cloud3d-params">
                {solution.estimated.map((p) => {
                  const u = PARAMETER_UNITS[p]
                  const sigma = solution.sigmas[p]
                  return (
                    <li key={p}>
                      <span>{names[p]}</span>
                      <span>{`${(solution.params[p] * u.factor).toFixed(u.digits)}${sigma != null ? ` ± ${(sigma * u.factor).toFixed(u.digits)}` : ''} ${u.unit}`}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="cloud3d-hint">
                {fill('cloud3d_reg_accuracy', {
                  sigma0: solution.sigma0 == null ? '–' : mm(solution.sigma0), rms: mm(solution.rms), max: mm(solution.max),
                  n: solution.equations, u: solution.unknowns,
                })}
              </p>
              {solution.residuals.some(r => r.suspect) && <p className="cloud3d-warn">{t('cloud3d_reg_suspect')}</p>}
              {solution.redundancy === 0 && <p className="cloud3d-warn">{t('cloud3d_reg_no_redundancy')}</p>}
            </>
          )}
          <div className="cloud3d-buttons">
            {mayEdit && <button type="button" disabled={!solution?.ok} onClick={() => reg.save({ by: userName })}>{t('cloud3d_reg_apply')}</button>}
            <button type="button" disabled={!solution?.ok} onClick={exportCsv}>{t('cloud3d_reg_csv')}</button>
            <button type="button" disabled={!solution?.ok} onClick={exportPdf}>{t('cloud3d_reg_pdf')}</button>
            <button type="button" onClick={reg.end}>{t('cloud3d_reg_end')}</button>
          </div>
          {reg.message && (
            <p className={reg.message.kind === 'done' ? 'cloud3d-hint' : 'cloud3d-warn'}>
              {tOr(t, reg.message.key, reg.message.fallback ?? reg.message.key)}
            </p>
          )}
        </>
      )}

      {adjRow && (
        <>
          <h2>{fill('cloud3d_reg_history', { name: adjRow.name })}</h2>
          {!reg.history.length && <p className="cloud3d-hint">{t('cloud3d_reg_history_none')}</p>}
          <ol className="cloud3d-points">
            {reg.history.map(h => (
              <li key={h.id}>
                <span>
                  {`${formatDate(h.createdAt, language, { time: true })} · ${h.createdByName ?? ''}`}
                  {h.active && <strong>{` · ${t('cloud3d_reg_in_force')}`}</strong>}
                </span>
                <span className="cloud3d-hint">
                  {fill('cloud3d_reg_history_row', {
                    n: h.pairs.length, sigma0: h.params.sigma0 == null ? '–' : mm(h.params.sigma0), max: mm(h.params.max),
                    reference: rows.find(r => r.id === h.referenceCloudId)?.name ?? '–',
                  })}
                </span>
                {mayEdit && !h.active && (
                  <span><button type="button" className="cloud3d-link" onClick={() => reg.activate(h.id)}>{t('cloud3d_reg_put_back')}</button></span>
                )}
              </li>
            ))}
          </ol>
          {mayEdit && adjRow.transform && (
            <div className="cloud3d-buttons">
              <button type="button" onClick={() => reg.activate(null)}>{t('cloud3d_reg_none')}</button>
            </div>
          )}
        </>
      )}
    </>
  )
}
