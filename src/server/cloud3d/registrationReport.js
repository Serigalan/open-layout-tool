/**
 * The protocol of a re-referencing (AP 13.14): parameters with their standard
 * deviations, the pairs with their residuals — as CSV, and as PDF for the
 * file. Units as a surveyor reads them: shifts in m, turns in mrad, scale in
 * ppm, residuals in mm.
 */

/** A parameter's value and standard deviation in display units. */
export const PARAMETER_UNITS = {
  tE: { factor: 1, unit: 'm', digits: 4 },
  tN: { factor: 1, unit: 'm', digits: 4 },
  tH: { factor: 1, unit: 'm', digits: 4 },
  kappa: { factor: 1000, unit: 'mrad', digits: 4 },
  omega: { factor: 1000, unit: 'mrad', digits: 4 },
  phi: { factor: 1000, unit: 'mrad', digits: 4 },
  scale: { factor: 1e6, unit: 'ppm', digits: 2 },
}

const fmt = (v, digits) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(digits))
const mm = (v) => (v == null ? '' : (v * 1000).toFixed(1))

/** The rows of the parameter table: `[name, value, sigma, unit]` for the estimated ones. */
export function parameterRows(solution, names) {
  return solution.estimated.map((p) => {
    const u = PARAMETER_UNITS[p]
    return [names[p] ?? p, fmt(solution.params[p] * u.factor, u.digits), fmt(solution.sigmas[p] == null ? null : solution.sigmas[p] * u.factor, u.digits), u.unit]
  })
}

/** The rows of the pair table, every pair (those switched off too, without residuals). */
export function pairRows(pairs, solution) {
  const res = new Map((solution?.residuals ?? []).map(r => [r.id, r]))
  return pairs.map((p, k) => {
    const r = p.on === false ? null : res.get(p.id)
    return [
      String(k + 1), p.label || p.id, p.kind === 'section' ? 'Querprofil' : '3D', p.on === false ? 'aus' : 'an',
      ...p.ref.map(v => v.toFixed(3)), ...p.src.map(v => v.toFixed(3)),
      mm(r?.across), mm(r?.along), mm(r?.height), r?.w == null ? '' : r.w.toFixed(2), r?.suspect ? 'ja' : '',
    ]
  })
}

const PAIR_HEAD = ['Nr', 'Kennung', 'Art', 'an/aus', 'Bezug E', 'Bezug N', 'Bezug H', 'Wolke E', 'Wolke N', 'Wolke H',
  'quer [mm]', 'längs [mm]', 'Höhe [mm]', 'w', 'verdächtig']

/** What the protocol says above the tables. */
function header({ project, cloud, reference, crs, heightName, person, date, options }) {
  return [
    ['Projekt', project ?? ''],
    ['Angepasste Wolke', cloud],
    ['Bezugswolke', reference ?? '–'],
    ['Zielsystem', `EPSG ${crs}${heightName ? `, Höhe ${heightName}` : ''}`],
    ['Geschätzt', ['Verschiebung Ost/Nord/Höhe', 'Drehung um die Lotrechte', ...(options.tilts ? ['beide Neigungen'] : []),
      ...(options.scale ? ['Maßstab'] : [])].join(', ')],
    ['Bearbeitet', `${person ?? ''} · ${date}`],
  ]
}

/**
 * The protocol as CSV (semicolons): the header lines, the parameters, the
 * accuracy and the pairs.
 */
export function protocolCsv({ solution, pairs, names, ...meta }) {
  const lines = header(meta).map(([k, v]) => `# ${k}: ${v}`)
  lines.push('', 'Parameter;Wert;Standardabweichung;Einheit')
  for (const row of parameterRows(solution, names)) lines.push(row.join(';'))
  lines.push('', `Standardabweichung der Gewichtseinheit [mm];${mm(solution.sigma0)}`,
    `Mittlerer Restfehler [mm];${mm(solution.rms)}`, `Größter Restfehler [mm];${mm(solution.max)}`,
    `Gleichungen;${solution.equations}`, `Unbekannte;${solution.unknowns}`, `Überbestimmung;${solution.redundancy}`,
    `Mittelpunkt E/N/H;${solution.centre.map(v => v.toFixed(3)).join(';')}`,
    `Matrix (zeilenweise);${solution.matrix.map(v => v.toPrecision(15)).join(';')}`, '')
  lines.push(PAIR_HEAD.join(';'))
  for (const row of pairRows(pairs, solution)) lines.push(row.join(';'))
  return lines.join('\r\n') + '\r\n'
}

/** Text for the PDF's standard font, which has no Greek. */
const LATIN = { 'κ': 'kappa', 'ω': 'omega', 'φ': 'phi', 'σ₀': 'sigma0', '–': '-', '“': '"', '”': '"', '„': '"' }
const latin = (v) => String(v).replace(/σ₀|[κωφ–“”„]/g, c => LATIN[c])

/** The protocol as a PDF (A4 landscape), jsPDF loaded only when asked for. */
export async function protocolPdf({ solution, pairs, names, ...meta }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(latin('Neureferenzierung einer Punktwolke – Protokoll'), 15, 16)
  doc.setFontSize(9)
  let y = 25
  for (const [k, v] of header(meta)) {
    doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, 15, y)
    doc.setFont('helvetica', 'normal'); doc.text(latin(v), 55, y)
    y += 5
  }
  y += 3
  const table = (head, rows, widths) => {
    const line = (cells, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      let x = 15
      cells.forEach((c, i) => { doc.text(latin(c), x, y); x += widths[i] })
      y += 4.6
      if (y > 195) { doc.addPage(); y = 16 }
    }
    line(head, true)
    for (const r of rows) line(r, false)
    y += 3
  }
  table(['Parameter', 'Wert', 'Std.-Abw.', 'Einheit'], parameterRows(solution, names), [60, 30, 30, 20])
  table(['Genauigkeit', ''], [
    ['Std.-Abw. der Gewichtseinheit', `${mm(solution.sigma0) || '–'} mm`],
    ['Mittlerer Restfehler', `${mm(solution.rms)} mm`],
    ['Größter Restfehler', `${mm(solution.max)} mm`],
    ['Gleichungen / Unbekannte', `${solution.equations} / ${solution.unknowns}`],
  ], [60, 40])
  doc.setFontSize(7.5)
  table(PAIR_HEAD, pairRows(pairs, solution), [8, 22, 17, 11, 21, 21, 14, 21, 21, 14, 15, 15, 15, 11, 14])
  return doc.output('blob')
}
