import { weichenGruppen, WEICHEN_REGELWERK } from '../utils/weichenRegelwerk'
import { switchKindLabelKey } from '../utils/switchModel'

/**
 * The switch form tables, read-only, inside the regelwerk popup — the second
 * entry of its selector (AP R.6). Only the rendering: which tables there are
 * and what a row of one holds is weichenRegelwerk.js, which reads them from
 * the tables the app actually draws with.
 *
 * Two column sets, because the forms genuinely differ: a turnout states the
 * minimum intermediate straight a connection needs and the straight piece its
 * branch ends in, a crossing states the tangent its body reaches over. A
 * single table of both would be half empty either way round.
 */

// Printed as the table states it — a rounded value would be a different rule.
// A form that does not state a value at all (a crossing with no cant mark)
// gets the dash, not a zero: it has none, it is not none.
const zahl = (v) => (v === null || v === undefined ? '–' : String(v))

// A crossing switch states a speed per route — the through road first, then
// the curves; a Bogenkreuzungsweiche its straight connection first, then the
// crossing roads and the inner curve. Printed as the table reads, "100 / 40", because one number for
// the whole form would be a claim the form does not make.
const speedText = (form) => (form.routen
  ? form.routen.map(route => route.speed).join(' / ')
  : zahl(form.speed))

// The radius the same way, route for route beside its speed — a straight route
// is one of infinite radius, not one without. A Bogenkreuzungsweiche has no
// single radius to print otherwise.
const radiusText = (form) => (form.routen
  ? form.routen.map(route => (route.R == null ? '∞' : String(route.R))).join(' / ')
  : zahl(form.radius))

export default function WeichenRegelwerk({ t }) {
  const gruppen = weichenGruppen()

  return (
    <>
      <p className="constraints-hint">
        {WEICHEN_REGELWERK.title} · {t('constraints_katalog_revision')}{' '}
        {WEICHEN_REGELWERK.katalog_version} ({WEICHEN_REGELWERK.status})
      </p>
      <p className="constraints-hint">{t('constraints_weichen_hint')}</p>
      {gruppen.map(gruppe => (
        <div key={gruppe.key}>
          <h4 className="constraints-subsection">{t(gruppe.titleKey)}</h4>
          <p className="constraints-hint">{t(gruppe.hintKey)}</p>
          <table className="track-table constraints-table">
            <thead>
              {gruppe.art === 'weiche' ? (
                <tr>
                  <th>{t('constraints_weichen_form')}</th>
                  <th>{t('constraints_weichen_radius')}</th>
                  <th>{t('constraints_weichen_neigung')}</th>
                  <th>{t('constraints_weichen_speed')}</th>
                  <th>{t('constraints_weichen_marke')}</th>
                  <th>{t('constraints_weichen_minl')}</th>
                  <th>{t('constraints_weichen_gerade')}</th>
                </tr>
              ) : (
                <tr>
                  <th>{t('constraints_weichen_form')}</th>
                  <th>{t('constraints_weichen_art')}</th>
                  <th>{t('constraints_weichen_neigung')}</th>
                  <th>{t('constraints_weichen_radius')}</th>
                  <th>{t('constraints_weichen_tangente')}</th>
                  <th>{t('constraints_weichen_speed')}</th>
                  <th>{t('constraints_weichen_marke')}</th>
                </tr>
              )}
            </thead>
            <tbody>
              {gruppe.formen.map(form => (
                <tr key={form.label}>
                  <td className="constraints-value">
                    {form.label}
                    {form.symmetrisch && (
                      <span className="constraints-note">{t('constraints_weichen_symmetrisch')}</span>
                    )}
                  </td>
                  {gruppe.art === 'weiche' ? (
                    <>
                      <td>{zahl(form.radius)}</td>
                      <td>1:{form.neigung}</td>
                      <td>{zahl(form.speed)}</td>
                      <td>{zahl(form.marke)}</td>
                      <td>{zahl(form.minl)}</td>
                      <td>{form.gerade ? String(form.gerade) : '–'}</td>
                    </>
                  ) : (
                    <>
                      <td>{t(switchKindLabelKey(form.kind))}</td>
                      <td>1:{form.neigung}</td>
                      <td>{radiusText(form)}</td>
                      <td>{zahl(form.tangente)}</td>
                      <td>{speedText(form)}</td>
                      <td>{zahl(form.marke)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
