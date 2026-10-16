import { useI18n } from '../../locales/i18nContext'

// A turnout in a 40 × 24 box, the track along its middle, drawn in the
// direction the turnout opens: with the track rightwards, against it leftwards
// (the arrow), the branch leaving to its left or right as seen that way.
const PATHS = {
  'along|left':    { track: 'M3 16 H37', arrow: 'M33 12.5 L37 16 L33 19.5', branch: 'M9 16 L31 5' },
  'along|right':   { track: 'M3 8 H37',  arrow: 'M33 4.5 L37 8 L33 11.5',  branch: 'M9 8 L31 19' },
  'against|left':  { track: 'M3 8 H37',  arrow: 'M7 4.5 L3 8 L7 11.5',     branch: 'M31 8 L9 19' },
  'against|right': { track: 'M3 16 H37', arrow: 'M7 12.5 L3 16 L7 19.5',   branch: 'M31 16 L9 5' },
}

function TurnoutSketch({ dir, side }) {
  const p = PATHS[`${dir}|${side}`]
  return (
    <svg viewBox="0 0 40 24" width="48" height="29" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={p.track} />
      <path d={p.arrow} />
      <path d={p.branch} />
    </svg>
  )
}

/**
 * Which way a turnout opens along its track and to which side it branches
 * (Entscheidung 312): four tiles in a square, each a sketch of the turnout —
 * the rows the direction (with / against the track), the columns the side.
 * `reversed` true is against the track direction.
 */
export default function SwitchOrientationPicker({ reversed, side, onChange }) {
  const { t } = useI18n()
  const rows = [[false, 'switch_on_track_along'], [true, 'switch_on_track_against']]
  const cols = [['left', 'switch_side_left'], ['right', 'switch_side_right']]
  return (
    <div className="switch-orientation" role="group" aria-label={`${t('switch_direction')} · ${t('switch_side')}`}>
      <span />
      {cols.map(([, key]) => <span key={key} className="switch-orientation-head">{t(key)}</span>)}
      {rows.map(([rev, rowKey]) => [
        <span key={rowKey} className="switch-orientation-row">{t(rowKey)}</span>,
        ...cols.map(([s, colKey]) => {
          const on = reversed === rev && side === s
          return (
            <button key={`${rowKey}-${s}`} type="button" className={`switch-orientation-tile${on ? ' active' : ''}`}
              aria-pressed={on} title={`${t(rowKey)} · ${t(colKey)}`}
              onClick={() => onChange({ reversed: rev, side: s })}>
              <TurnoutSketch dir={rev ? 'against' : 'along'} side={s} />
            </button>
          )
        }),
      ])}
    </div>
  )
}
