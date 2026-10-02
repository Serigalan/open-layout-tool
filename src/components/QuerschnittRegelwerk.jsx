import {
  QUERSCHNITT_KATALOG, GAUGE_PROFILES, gaugeProfileRing, gaugeProfileAreas, gaugeProfileLabelKey,
  LICHTRAUM_SOURCE,
} from '../utils/gaugeProfiles'

/**
 * DB Ril 800.0130, Streckenquerschnitte auf Erdkörpern, read-only inside the
 * regelwerk popup: the standard cross sections per line category, and the
 * clearance profiles drawn to scale — the same outlines the cross section
 * overlay leans with the cant.
 *
 * A drawing is in millimetres throughout, the file's own unit; only the sign
 * of z flips, because SVG counts down and the profile counts up from top of
 * rail.
 */

const meter = (v) => (v === null || v === undefined ? '–' : v.toFixed(2))

const speedRange = (row) => (row.v_min !== undefined
  ? `${row.v_min} < ve ≤ ${row.v_max}`
  : `ve ≤ ${row.v_max}`)

// Drawing constants, in mm of the profile: the gap between the outline and
// its first dimension line, the step between two dimension lines, the text.
const DIM_GAP  = 350
const DIM_STEP = 330
const TEXT     = 130
const TICK     = 60

const distinctPositive = (values) => [...new Set(values)].filter(v => v > 0).sort((a, b) => a - b)

function ProfileDrawing({ profile, t }) {
  const ring  = gaugeProfileRing(profile.points)
  const areas = gaugeProfileAreas(profile.einragungen)

  // Dimensioned the way the Ril states the profile: every width from the track
  // centre, every height from top of rail — one baseline each, not a chain.
  const widths  = distinctPositive(profile.points.map(([y]) => y))
  const heights = distinctPositive(profile.points.map(([, z]) => z))
  const yMax = Math.max(...widths)
  const zMax = Math.max(...heights)

  const xRight  = yMax + DIM_GAP + (heights.length - 1) * DIM_STEP + TEXT * 2
  const yBottom = DIM_GAP + (widths.length - 1) * DIM_STEP + TEXT * 2
  const viewBox = [-yMax - 250, -zMax - 350, yMax + 250 + xRight, zMax + 350 + yBottom].join(' ')

  const path = (points) => points.map(([y, z], i) => `${i ? 'L' : 'M'}${y},${-z}`).join(' ')
  const line = { vectorEffect: 'non-scaling-stroke' }

  return (
    <figure className="querschnitt-figure">
      <figcaption className="constraints-value">{t(gaugeProfileLabelKey(profile.id))}</figcaption>
      <svg viewBox={viewBox} className="querschnitt-svg" role="img"
        aria-label={`${t(gaugeProfileLabelKey(profile.id))} · ${LICHTRAUM_SOURCE}`}>
        <path d={`${path(ring)} Z`} fill="rgba(48,51,131,0.08)" stroke="var(--color-primary)"
          strokeWidth="1.6" {...line} />
        {areas.map((a, i) => (
          <path key={i} d={`${path(a)} Z`} fill="#ffffff" fillOpacity="0.7"
            stroke="var(--color-primary)" strokeWidth="1" strokeDasharray="5 4" {...line} />
        ))}

        {/* track centre and top of rail, the two lines everything is measured from */}
        <line x1="0" y1={-zMax - 250} x2="0" y2={DIM_GAP / 2} stroke="#888" strokeWidth="1"
          strokeDasharray="10 4 2 4" {...line} />
        <line x1={-yMax - 200} y1="0" x2={yMax + 200} y2="0" stroke="#333" strokeWidth="1.4" {...line} />
        <text x={-yMax - 200} y={-TEXT * 0.5} fontSize={TEXT} fill="#555">{t('constraints_querschnitt_so')}</text>
        <text x={TEXT * 0.4} y={-zMax - 150} fontSize={TEXT} fill="#555">{t('constraints_querschnitt_gleismitte')}</text>

        {widths.map((w, i) => {
          const z = DIM_GAP + i * DIM_STEP
          return (
            <g key={`w${w}`} stroke="#555" strokeWidth="1">
              <line x1="0" y1={z} x2={w} y2={z} {...line} />
              <line x1="0" y1={z - TICK} x2="0" y2={z + TICK} {...line} />
              <line x1={w} y1={z - TICK} x2={w} y2={z + TICK} {...line} />
              <line x1={w} y1="0" x2={w} y2={z} strokeDasharray="3 3" opacity="0.5" {...line} />
              <text x={w / 2} y={z - TEXT * 0.3} fontSize={TEXT} fill="#333" stroke="none"
                textAnchor="middle">{w}</text>
            </g>
          )
        })}

        {heights.map((h, i) => {
          const x = yMax + DIM_GAP + i * DIM_STEP
          const edge = Math.max(...profile.points.filter(([, z]) => z === h).map(([y]) => y))
          return (
            <g key={`h${h}`} stroke="#555" strokeWidth="1">
              <line x1={x} y1="0" x2={x} y2={-h} {...line} />
              <line x1={x - TICK} y1="0" x2={x + TICK} y2="0" {...line} />
              <line x1={x - TICK} y1={-h} x2={x + TICK} y2={-h} {...line} />
              <line x1={edge} y1={-h} x2={x} y2={-h} strokeDasharray="3 3" opacity="0.5" {...line} />
              <text x={x - TEXT * 0.3} y={-h / 2} fontSize={TEXT} fill="#333" stroke="none"
                textAnchor="middle" transform={`rotate(-90 ${x - TEXT * 0.3} ${-h / 2})`}>{h}</text>
            </g>
          )
        })}
      </svg>

      <table className="track-table constraints-table querschnitt-points">
        <tbody>
          <tr>
            <td>{t('constraints_querschnitt_umriss')}</td>
            <td className="constraints-expr">{profile.points.map(p => `[${p.join(', ')}]`).join(' ')}</td>
          </tr>
          {profile.einragungen.map((area, i) => (
            <tr key={i}>
              <td>
                {profile.areaKinds[i]
                  ? t(`constraints_querschnitt_einragung_${profile.areaKinds[i]}`)
                  : `${t('constraints_querschnitt_einragung')} ${i + 1}`}
              </td>
              <td className="constraints-expr">{area.map(p => `[${p.join(', ')}]`).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export default function QuerschnittRegelwerk({ t }) {
  const { katalog, streckenquerschnitte } = QUERSCHNITT_KATALOG

  return (
    <>
      <p className="constraints-hint">
        {t(`regelwerk_title_${katalog.id}`)} · {t('constraints_katalog_revision')} {katalog.katalog_version}{' '}
        ({katalog.status})
      </p>
      <p className="constraints-hint">{t('constraints_querschnitt_hint')}</p>

      <h4 className="constraints-subsection">{t('constraints_querschnitt_strecken')}</h4>
      <p className="constraints-hint">{t('constraints_querschnitt_strecken_hint')}</p>
      <table className="track-table constraints-table">
        <thead>
          <tr>
            <th>{t('constraints_querschnitt_kategorie')}</th>
            <th>{t('constraints_querschnitt_ve')}</th>
            <th>{t('constraints_querschnitt_gleisabstand')}</th>
            <th>{t('constraints_querschnitt_planumskante')}</th>
            <th>{t('constraints_querschnitt_planumsbreite')}</th>
          </tr>
        </thead>
        <tbody>
          {streckenquerschnitte.rows.map(row => (
            <tr key={`${row.kategorie}${row.v_max}`}>
              <td className="constraints-value">{t(`constraints_querschnitt_kategorie_${row.kategorie}`)}</td>
              <td>{speedRange(row)}</td>
              <td>{meter(row.gleisabstand)}</td>
              <td>{meter(row.planumskante)}</td>
              <td>{meter(row.planumsbreite)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="constraints-subsection">{t('constraints_querschnitt_lichtraum')}</h4>
      <p className="constraints-hint">{t('constraints_querschnitt_lichtraum_hint')}</p>
      <div className="querschnitt-profiles">
        {Object.entries(GAUGE_PROFILES).map(([id, profile]) => (
          <ProfileDrawing key={id} profile={profile} t={t} />
        ))}
      </div>
    </>
  )
}
