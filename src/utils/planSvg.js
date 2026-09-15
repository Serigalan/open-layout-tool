/**
 * SVG backend for the plan model — the same primitives the PDF backend draws,
 * so the preview shows what gets printed. Millimetres are the user unit, and
 * the sheet states its physical size too, so the file opens at true scale in a
 * drawing program.
 *
 * The one convention to keep straight: `angle` in the model is
 * counter-clockwise positive (jsPDF), while SVG's rotate() turns clockwise —
 * hence the negation.
 */

const SUB_SIZE = '75%'
const SUB_SHIFT = '-25%'

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const num = (v) => (Math.round(v * 1000) / 1000).toString()

function pathData(d) {
  return d.map(c => {
    if (c[0] === 'Z') return 'Z'
    return `${c[0]} ${c.slice(1).map(num).join(' ')}`
  }).join(' ')
}

function renderPath(item) {
  const attrs = [
    `d="${pathData(item.d)}"`,
    `fill="${item.fill ?? 'none'}"`,
    item.stroke ? `stroke="${item.stroke}" stroke-width="${num(item.width)}"` : 'stroke="none"',
    item.dash ? `stroke-dasharray="${item.dash.map(num).join(' ')}"` : '',
    item.opacity < 1 ? `opacity="${num(item.opacity)}"` : '',
  ].filter(Boolean)
  return `<path ${attrs.join(' ')}/>`
}

function renderText(item, ids) {
  const anchor = item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start'
  const spans = item.parts.map(p => {
    const attrs = []
    if (p.sub) attrs.push(`font-size="${SUB_SIZE}"`, `baseline-shift="${SUB_SHIFT}"`)
    if (p.color) attrs.push(`fill="${p.color}"`)
    return attrs.length ? `<tspan ${attrs.join(' ')}>${esc(p.t)}</tspan>` : esc(p.t)
  }).join('')
  // xml:space keeps the spacing the model set: SVG folds repeated spaces by
  // default, which would silently undo the gaps around a separator that the PDF
  // backend, measuring glyph by glyph, does honour.
  const common = `font-size="${num(item.size)}" fill="${item.color}" xml:space="preserve"`

  // A label with a path is set along it — this is what SVG's textPath is for.
  if (item.path?.length > 1) {
    const id = `tp${ids.next++}`
    const d = item.path.map(([x, y], i) => `${i ? 'L' : 'M'} ${num(x)} ${num(y)}`).join(' ')
    const start = item.align === 'center' ? '50%' : item.align === 'right' ? '100%' : '0%'
    return `<path id="${id}" d="${d}" fill="none" stroke="none"/>`
      + `<text ${common}><textPath href="#${id}" startOffset="${start}"`
      + ` text-anchor="${anchor}">${spans}</textPath></text>`
  }

  const rotate = item.angle
    ? ` transform="rotate(${num(-item.angle)} ${num(item.x)} ${num(item.y)})"`
    : ''
  return `<text x="${num(item.x)}" y="${num(item.y)}" ${common}`
    + ` text-anchor="${anchor}"${rotate}>${spans}</text>`
}

function renderImage(item) {
  return `<image href="${item.dataUrl}" x="${num(item.x)}" y="${num(item.y)}"`
    + ` width="${num(item.w)}" height="${num(item.h)}"`
    + (item.opacity < 1 ? ` opacity="${num(item.opacity)}"` : '') + '/>'
}

function renderItems(items, ids) {
  return items.map(item => {
    if (item.type === 'path')  return renderPath(item)
    if (item.type === 'text')  return renderText(item, ids)
    if (item.type === 'image') return renderImage(item)
    if (item.type === 'group') {
      const id = `clip${ids.next++}`
      const { x, y, w, h } = item.clip
      return `<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}"`
        + ` width="${num(w)}" height="${num(h)}"/></clipPath>`
        + `<g clip-path="url(#${id})">${renderItems(item.items, ids)}</g>`
    }
    return ''
  }).join('')
}

/**
 * One sheet as an SVG document.
 * @param {object} plan   from buildPlan
 * @param {number} index  which sheet
 * @param {{ standalone?: boolean }} opts  standalone adds the XML header
 */
export function renderSvg(plan, index = 0, { standalone = false } = {}) {
  const { pageW, pageH } = plan
  const sheet = plan.sheets[index]
  const body = `<rect x="0" y="0" width="${pageW}" height="${pageH}" fill="#ffffff"/>`
    + renderItems(sheet.items, { next: 0 })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`
    + ` width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}"`
    + ` font-family="Helvetica, Arial, sans-serif">${body}</svg>`
  return standalone ? `<?xml version="1.0" encoding="UTF-8"?>\n${svg}` : svg
}

/** Every sheet of a plan as its own SVG document. */
export function renderSvgSheets(plan, opts) {
  return plan.sheets.map((_, i) => renderSvg(plan, i, opts))
}
