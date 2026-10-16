import { useI18n } from '../../../locales/i18nContext'
import { formatNum } from '../../../locales/i18n'
import { crsLabel } from '../../../utils/geometry/coordinateUtils'
import { trackListLabel } from '../../../utils/track/trackGroups'
import Modal from '../../Modal'

/** How many of the tracks that go along are named; the rest are counted. */
const NAMED = 8

/**
 * Before a track goes into another plane (decision 319): which tracks go with
 * it — the ones its turnouts and crossings join it to —, and what the move
 * costs, as previewTracksToPlane worked it out. The nodes stay where they are
 * on the ground; lengths and radii follow the plane's scale, and a joint's
 * tangent may open by a hair. Where an element carries no nodes the move is
 * refused, and the dialog only says why.
 *
 * `change` { tracks, epsg, report }; `onConfirm` commits it.
 */
export default function PlaneChangeDialog({ change, busy, onConfirm, onCancel }) {
  const { t, fill, language } = useI18n()
  const { tracks, epsg, report } = change
  const refused = report.refused > 0
  // How far a length stretches, per kilometre — the scale is 1 ± a few 1e-4.
  const mmPerKm = Math.max(Math.abs(report.scale.min - 1), Math.abs(report.scale.max - 1)) * 1e6
  const [first, ...rest] = tracks

  return (
    <Modal title={t('project_settings_move_title')} onClose={onCancel} busy={busy}
      actions={<>
        <button type="button" className="modal-btn modal-btn-cancel" onClick={onCancel} disabled={busy}>
          {t(refused ? 'btn_close' : 'btn_cancel')}
        </button>
        {!refused && (
          <button type="button" className="modal-btn modal-btn-primary" onClick={onConfirm} disabled={busy}>
            {t('project_settings_move_confirm')}
          </button>
        )}
      </>}>
      <p className="modal-message">
        {fill('project_settings_move_ask', { track: trackListLabel(first), crs: crsLabel(epsg) })}
      </p>
      {rest.length > 0 && (
        <>
          <p className="modal-message">{fill('project_settings_move_group', { n: rest.length })}</p>
          <ul className="form-list">
            {rest.slice(0, NAMED).map(tr => <li key={tr.id}>{trackListLabel(tr)}</li>)}
            {rest.length > NAMED && <li>{fill('project_settings_move_more', { n: rest.length - NAMED })}</li>}
          </ul>
        </>
      )}
      {refused ? (
        <p className="form-error">{fill('project_settings_move_refused', { n: report.refused })}</p>
      ) : (
        <p className="modal-message">
          {fill('project_settings_move_cost', {
            mm: formatNum(mmPerKm, language, { digits: 1 }),
            deg: report.tangentGap.toExponential(1),
          })}
        </p>
      )}
    </Modal>
  )
}
