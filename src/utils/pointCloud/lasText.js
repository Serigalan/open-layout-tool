import { format } from '../../locales/i18n'
/**
 * The head of a LAS/LAZ/E57 file as plain text, one point per line — what las2txt
 * would print — so the coordinates can be read before the file is imported:
 * many deliveries state no coordinate system, and the numbers themselves tell
 * (a Gauss-Krüger easting has seven digits and begins with its zone, a UTM one
 * six, or eight with the zone in front).
 */

/** How many points the text shows. */
export const PREVIEW_POINTS = 200

/** Decimals the file's scale resolves: 0.001 → 3, 0.01 → 2. */
export function decimalsOf(scale) {
  if (!(scale > 0)) return 3
  return Math.min(9, Math.max(0, Math.ceil(-Math.log10(scale) - 1e-9)))
}

const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : String(v))

const DEFAULT_LABELS = {
  format: 'point format', points: 'points', scale: 'scale', offset: 'offset',
  first: 'first {n} points', intensity: 'intensity', scans: 'scans', crs: 'coordinate system',
}

/** The file's format and version: „LAS 1.2“, „LAS 1.4 (LAZ)“, „E57 1.0“. */
export const formatName = (header) => (header.format === 'e57'
  ? `E57 ${header.version}`
  : `LAS ${header.version}${header.compressed ? ' (LAZ)' : ''}`)

/**
 * The text: a short commented header (file, format and version, point count,
 * scale and offset — for E57 the scans and the coordinate system it states —,
 * extent), a column line, then `x y z intensity` per point, separated
 * by tabs so it pastes into a spreadsheet as columns. `labels` translate the
 * header's words (DEFAULT_LABELS).
 */
export function pointsAsText(header, points, { name = '', labels = {} } = {}) {
  const l = { ...DEFAULT_LABELS, ...labels }
  const [dx, dy, dz] = header.scale.map(decimalsOf)
  const triple = (v) => `${fmt(v[0], dx)} ${fmt(v[1], dy)} ${fmt(v[2], dz)}`
  const lines = [
    ...(name ? [`# ${name}`] : []),
    ...(header.format === 'e57'
      ? [
        `# ${formatName(header)}, ${l.scans}: ${header.scans.length}, ${header.pointCount} ${l.points}`,
        ...(header.coordinateMetadata ? [`# ${l.crs}: ${header.coordinateMetadata}`] : []),
      ]
      : [
        `# ${formatName(header)}, ${l.format} ${header.pointFormat}, ${header.pointCount} ${l.points}`,
        `# ${l.scale} ${header.scale.join(' ')}  ${l.offset} ${header.offset.join(' ')}`,
      ]),
    `# min ${triple(header.min)}`,
    `# max ${triple(header.max)}`,
    `# ${format(l.first, { n: points.length })}:`,
    `X\tY\tZ\t${l.intensity}`,
    ...points.map(p => `${fmt(p.x, dx)}\t${fmt(p.y, dy)}\t${fmt(p.z, dz)}\t${p.intensity}`),
  ]
  return lines.join('\n')
}
