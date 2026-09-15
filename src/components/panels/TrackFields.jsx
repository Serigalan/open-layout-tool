import { TYPE_CODES, SIDE_CODES } from '../../utils/identifierUtils'
import StationNameInput from './StationNameInput'

const OWNERS = ['DB', 'SNCF', 'other']

function lineNumError(owner, lineNumber) {
  if (!lineNumber) return null
  const str = String(lineNumber)
  if (owner === 'DB'   && !/^\d{4}$/.test(str)) return 'db'
  if (owner === 'SNCF' && !/^\d{6}$/.test(str)) return 'sncf'
  return null
}

export default function TrackFields({ t, fields, setField, name, onNameChange, nameError, lineOptions }) {
  const { owner, type, lineNumber, lineName, side, stationName, uicStation, trackNumber } = fields
  const hasNameField = onNameChange !== undefined
  const lineErr = lineNumError(owner, lineNumber)

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
      {type === 'line_track' && (
        <>
          <div className="form-field">
            <label>{t('line_number')}</label>
            <input
              type="number"
              value={lineNumber}
              onChange={(e) => setField('lineNumber', e.target.value)}
              style={lineErr ? { borderColor: '#e74c3c' } : undefined}
            />
            {lineErr && (
              <span style={{ color: '#e74c3c', fontSize: '11px', fontFamily: 'system-ui, sans-serif' }}>
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
                style={nameError ? { borderColor: 'red' } : undefined}
              />
              {nameError && <span style={{ color: '#e74c3c', fontSize: '11px', fontFamily: 'system-ui, sans-serif' }}>{t('track_name_exists')}</span>}
            </div>
          )}
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
            <input type="number" value={trackNumber} onChange={(e) => setField('trackNumber', e.target.value)} />
          </div>
          {hasNameField && (
            <div className="form-field">
              <label>{t('track_name')}</label>
              <input
                type="text"
                value={name ?? ''}
                onChange={(e) => onNameChange(e.target.value)}
                style={nameError ? { borderColor: 'red' } : undefined}
              />
              {nameError && <span style={{ color: '#e74c3c', fontSize: '11px', fontFamily: 'system-ui, sans-serif' }}>{t('track_name_exists')}</span>}
            </div>
          )}
        </>
      )}
    </>
  )
}
