import { Fragment, useState } from 'react'
import { weichenGruppen, WEICHEN_REGELWERK } from '../utils/switch'
import { switchKindLabelKey } from '../utils/track'
import { useI18n } from '../locales/i18nContext'
import InfoTip from './form/InfoTip'

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

// A variant's sleepers: the count WA–ldS, and the ones outside it in brackets
// (before WA / behind the ldS on the main and on the branch track).
const schwellenText = (v) => (v.schwellenzahl == null ? '–'
  : `${v.schwellenzahl}${v.klammer ? ` (${v.klammer.join('/')})` : ''}`)

/** The variants of one form, as the table under its row (Paket WD). */
function Varianten({ varianten, colSpan }) {
  const { t } = useI18n()
  return (
    <tr className="constraints-variants">
      <td colSpan={colSpan}>
        <table className="track-table constraints-table">
          <thead>
            <tr>
              <th>{t('constraints_weichen_var_nr')}</th>
              <th>{t('constraints_weichen_var_bezeichnung')}</th>
              <th>{t('constraints_weichen_var_profil')}</th>
              <th>{t('constraints_weichen_var_schwellen')}</th>
              <th>{t('constraints_weichen_var_klasse')}</th>
              <th title={t('constraints_weichen_var_schwellenzahl_hint')}>{t('constraints_weichen_var_schwellenzahl')}</th>
              <th>{t('constraints_weichen_var_zs_wa')}</th>
              <th>{t('constraints_weichen_var_r_ibw')}</th>
            </tr>
          </thead>
          <tbody>
            {varianten.map(v => (
              <tr key={v.nr}>
                <td>{v.nr}</td>
                <td className="constraints-value">{v.bezeichnung}</td>
                <td>{v.profil}</td>
                <td>{t(v.schwellen === 'holz' ? 'constraints_weichen_var_holz' : 'constraints_weichen_var_beton')}</td>
                <td>{t(v.klasse === 'regel' ? 'constraints_weichen_var_regel' : 'constraints_weichen_var_sonder')}</td>
                <td>{schwellenText(v)}</td>
                <td>{zahl(v.zs_wa)}</td>
                <td>{zahl(v.r_ibw_min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

export default function WeichenRegelwerk() {
  const { t } = useI18n()
  const gruppen = weichenGruppen()
  // The form whose variants are open — one at a time, the table is long enough.
  const [offen, setOffen] = useState(null)

  return (
    <>
      <p className="constraints-hint">
        {t(`regelwerk_title_${WEICHEN_REGELWERK.id}`)} · {t('constraints_katalog_revision')}{' '}
        {WEICHEN_REGELWERK.katalog_version} ({WEICHEN_REGELWERK.status})
        <InfoTip text={t('constraints_weichen_hint')} />
      </p>
      {gruppen.map(gruppe => (
        <div key={gruppe.key}>
          <h4 className="constraints-subsection">{t(gruppe.titleKey)}<InfoTip text={t(gruppe.hintKey)} /></h4>
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
                  <th title={t('constraints_weichen_lds_hint')}>{t('constraints_weichen_lds')}</th>
                  <th title={t('constraints_weichen_varianten_hint')}>{t('constraints_weichen_varianten')}</th>
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
                  <th title={t('constraints_weichen_varianten_hint')}>{t('constraints_weichen_varianten')}</th>
                </tr>
              )}
            </thead>
            <tbody>
              {gruppe.formen.map(form => (
                <Fragment key={form.label}>
                <tr>
                  <td className="constraints-value">
                    {form.label}
                    {form.symmetrisch && (
                      <span className="constraints-note">{t('constraints_weichen_symmetrisch')}</span>
                    )}
                    {form.herzstueck && (
                      <span className="constraints-note">
                        {t(form.herzstueck === 'gb' ? 'constraints_weichen_herz_gb' : 'constraints_weichen_herz_fb')}
                      </span>
                    )}
                  </td>
                  {gruppe.art === 'weiche' ? (
                    <>
                      <td>{zahl(form.radius)}</td>
                      <td>1:{form.neigung}</td>
                      <td>{zahl(form.speed)}</td>
                      <td>
                        {zahl(form.marke)}
                        {form.markeBerechnet && <span className="constraints-note">{t('constraints_weichen_marke_berechnet')}</span>}
                      </td>
                      <td>{zahl(form.minl)}</td>
                      <td>{form.gerade ? String(form.gerade) : '–'}</td>
                      <td>{form.lds === 0 ? t('constraints_weichen_lds_we') : zahl(form.lds)}</td>
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
                  <td>
                    {form.varianten.length ? (
                      <button type="button" className="constraints-variants-toggle" aria-expanded={offen === form.label}
                        onClick={() => setOffen(offen === form.label ? null : form.label)}>
                        {offen === form.label ? '▾' : '▸'} {form.varianten.length}
                      </button>
                    ) : '–'}
                  </td>
                </tr>
                {offen === form.label && (
                  <Varianten varianten={form.varianten} colSpan={gruppe.art === 'weiche' ? 9 : 8} />
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
