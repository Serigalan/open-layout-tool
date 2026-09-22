// Turns a regelwerk (as GET /regelwerke/<id> returns it — see
// tools/optimizer/olt_optimizer/regelwerke/db-ril-800.json for the shape)
// into table rows for the viewer panel (AP R.5, stage 1: showing). Kept as
// plain functions, not JSX, so they run in the Node test suite without a DOM.

// Where each value is read, for a column no JSON field carries — this is
// app knowledge, not something the regelwerk states about itself. A path
// this doesn't know still gets a row, just a generic label, so a future
// regelwerk entry nobody has wired in here yet is still visible rather than
// silently dropped.
const WHERE_USED = {
  'ueberhoehung.u_max': 'Optimierer — Überhöhungsdecke',
  'ueberhoehung.u_step': 'Optimierer — Überhöhungsraster',
  'weiche.u_max': 'Optimierer, Weichendialoge — Überhöhungsdecke auf der Weichenstraße',
  'weiche.uf_max': 'Optimierer, Weichendialoge — Überhöhungsfehlbetragsdecke auf der Weichenstraße',
  'weiche.ausnahme_120': 'nur dokumentiert — kein Lauf nutzt sie automatisch',
  'rampenregel.faktor_klothoide': 'Optimierer — Rampenlänge bei Klothoiden-Übergangsbögen',
  'rampenregel.faktor_bloss': 'Optimierer — Rampenlänge bei Bloß-Übergangsbögen',
  'mindestlaenge.koeffizient': 'Optimierer — Mindestlänge von Elementen und Rampen',
  'baubarkeitsraster.radius_schritt': 'Optimierer — Radienraster',
  'baubarkeitsraster.radius_min': 'Optimierer — kleinster vorgeschlagener Radius',
  'baubarkeitsraster.laenge_schritt': 'Optimierer — Längenraster',
  'bestand.unterliegt_rampenregel': 'Optimierer — gilt für eine bestehende Lage nicht',
}

/** Is `node` a leaf like { wert, einheit?, quelle?, warum?, ... }? */
function isLeaf(node) {
  return node && typeof node === 'object' && !Array.isArray(node)
    && 'wert' in node && (typeof node.wert !== 'object' || node.wert === null)
}

/**
 * One row per { wert, ... } leaf in the regelwerk, in the order the JSON
 * defines them. Each row: { path, wert, einheit, quelle, warum, woVerwendet }.
 * `wert` keeps its JSON type (number or boolean) — formatting for display is
 * the caller's job, same split `formatGrund` keeps in optimizeReport.js.
 */
export function flattenRegelwerk(regelwerk) {
  const rows = []
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (isLeaf(child)) {
        rows.push({
          path,
          wert: child.wert,
          einheit: child.einheit ?? '',
          quelle: child.quelle ?? '',
          warum: child.warum ?? '',
          woVerwendet: WHERE_USED[path] ?? 'Optimierer',
        })
      } else {
        walk(child, path)
      }
    }
  }
  walk(regelwerk, '')
  return rows
}
