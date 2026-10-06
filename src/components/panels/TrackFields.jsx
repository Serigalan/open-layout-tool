import { TYPE_CODES, SIDE_CODES, LINE_CATEGORIES, TRACK_USES } from '../../utils/identifierUtils'
import { projectLineCategory } from '../../utils/gradientCheck'
import { currentProject } from '../../storage'
import StationNameInput from './StationNameInput'
import useLineNameSuggestion from '../../hooks/useLineNameSuggestion'
import { useI18n } from '../../locales/i18nContext'
import NumberInput from '../form/NumberInput'

const OWNERS = ['DB', 'SNCF', 'other']

function lineNumError(owner, lineNumber) {
  if (!lineNumber) return null
  const str = String(lineNumber)
  if (owner === 'DB'   && !/^\d{4}$/.test(str)) return 'db'
  if (owner === 'SNCF' && !/^\d{6}$/.test(str)) return 'sncf'
  return null
}

export default function TrackFields({ fields, setField, name, onNameChange, nameError, lineOptions }) {
  const { t } = useI18n()
  const { owner, type, lineNumber, lineName, side, stationName, uicStation, trackNumber, lineCategory, trackUse } = fields
  const hasNameField = onNameChange !== undefined
  const lineErr = lineNumError(owner, lineNumber)
  useLineNameSuggestion(lineNumber, lineName, setField, type === 'line_track')

  return (
    <>
      <div className="form-field">
        <label>{t('owner')}</label>
        <select value={owner} onChange={(e) => setField('owner', e.target.value)}>
          {OWNERS.map((o) => (
            <option key={o} value={o}>{t(`owner_${o}`)}</option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label>{t('type')}</label>
        <select value={type} onChange={(e) => setField('type', e.target.value)}>
          {Object.keys(TYPE_CODES).map((key) => (
            <option key={key} value={key}>{t(`type_${key}`)}</option>
          ))}
        </select>
      </div>
      {/* What the Höhenplan rules ask of a track (gradientCheck): a siding may
          leave larger gradient changes unrounded. */}
      <div className="form-field">
        <label>{t('track_use')}</label>
        <select value={trackUse ?? 'main'} onChange={(e) => setField('trackUse', e.target.value)}>
          {TRACK_USES.map((key) => (
            <option key={key} value={key}>{t(`track_use_${key}`)}</option>
          ))}
        </select>
      </div>
      {type === 'line_track' && (
        <>
          <div className="form-field">
            <label>{t('line_number')}</label>
            <NumberInput
             
              value={lineNumber}
              onChange={(e) => setField('lineNumber', e.target.value)}
              className={lineErr ? 'input-error' : undefined}
            />
            {lineErr && (
              <span className="msg-error msg-small">
                {t(lineErr === 'db' ? 'line_number_error_db' : 'line_number_error_sncf')}
              </span>
            )}
            {/* The lines the kilometrage overlay shows around the view, as
                something to pick instead of type. Absent where the overlay is
                off, which is why the field itself stays an input. */}
            {(lineOptions?.length ?? 0) > 0 && (
              <div className="line-suggestions">
                {lineOptions.map(({ lineNumber: number, distance }) => (
                  <button
                    key={number}
                    type="button"
                    className={`line-suggestion${String(number) === String(lineNumber) ? ' active' : ''}`}
                    onClick={() => setField('lineNumber', String(number))}
                  >
                    {number}
                    <span className="line-suggestion-distance">{distance} m</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="form-field">
            <label>{t('line_name')}</label>
            <input
              type="text"
              value={lineName}
              onChange={(e) => setField('lineName', e.target.value)}
            />
          </div>
          {hasNameField && (
            <div className="form-field">
              <label>{t('track_name')}</label>
              <input
                type="text"
                value={name ?? ''}
                onChange={(e) => onNameChange(e.target.value)}
                className={nameError ? 'input-error' : undefined}
              />
              {nameError && <span className="msg-error msg-small">{t('track_name_exists')}</span>}
            </div>
          )}
          <div className="form-field">
            <label>{t('line_category')}</label>
            <select value={lineCategory ?? ''} onChange={(e) => setField('lineCategory', e.target.value)}>
              <option value="">
                {`${t('line_category_project')} (${t(`line_category_${projectLineCategory(currentProject())}`)})`}
              </option>
              {LINE_CATEGORIES.map((key) => (
                <option key={key} value={key}>{t(`line_category_${key}`)}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>{t('side')}</label>
            <select value={side} onChange={(e) => setField('side', e.target.value)}>
              {Object.keys(SIDE_CODES).map((key) => (
                <option key={key} value={key}>{t(`side_${key}`)}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {type === 'station_track' && (
        <>
          <div className="form-field">
            <label>{t('station_name')}</label>
            <StationNameInput
              value={stationName}
              onChange={(e) => setField('stationName', e.target.value)}
              onSelectSuggestion={(s) => {
                setField('stationName', s.name)
                setField('uicStation', s.uic)
              }}
            />
          </div>
          <div className="form-field">
            <label>{t('uic_station_number')}</label>
            <input type="text" value={uicStation} onChange={(e) => setField('uicStation', e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('track_number')}</label>
            <NumberInput value={trackNumber} onChange={(e) => setField('trackNumber', e.target.value)} />
          </div>
          {hasNameField && (
            <div className="form-field">
              <label>{t('track_name')}</label>
              <input
                type="text"
                value={name ?? ''}
                onChange={(e) => onNameChange(e.target.value)}
                className={nameError ? 'input-error' : undefined}
              />
              {nameError && <span className="msg-error msg-small">{t('track_name_exists')}</span>}
            </div>
          )}
        </>
      )}
    </>
  )
}
