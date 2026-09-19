import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as icons from './icons'

// The rule AP 4.3 states: one size, one stroke width, one node radius,
// currentColor, and a drawing that stays inside its box. The panels render
// these on whatever colour the button says, so an icon may not carry a colour
// of its own; and a node at the edge would be half gone, a path beyond it
// clipped.
const SIZE = 16
const STROKE = 1.5
const NODE = 1.5

const MENU_ICONS = [
  'BackIcon',
  'CreateLineIcon', 'CreateArcIcon', 'CreateParallelIcon', 'CreateParallelTrackIcon',
  'ConnectStraightIcon', 'ConnectCurvedIcon',
  'SwitchStraightIcon', 'SwitchCurvedIcon', 'SwitchOnTrackIcon', 'SwitchConnectionIcon',
  'EditLengthIcon', 'DeleteElementIcon', 'EditTracksIcon', 'EditPropertiesIcon',
  'ChangeDirectionIcon', 'DeleteTrackIcon', 'DeleteSwitchIcon',
  'OptimizeTrackModeIcon', 'OptimizeElementModeIcon',
  'CrossingIcon', 'CrossingSwitchIcon',
]

// Walk a path the way a renderer does and state every absolute position it
// reaches — endpoints and control points alike. A Bézier stays inside the
// convex hull of its control points, so control points in the box mean the
// curve is; endpoints alone would not say that. Relative commands are offsets
// from the current point, which is why the numbers of a `d` cannot be read
// as positions directly.
const NUM = /-?\d*\.?\d+/g
const pathPositions = (d) => {
  const pts = []
  let x = 0, y = 0        // the current point
  let mx = 0, my = 0      // the subpath start (where Z returns to)
  for (const cmd of d.match(/[a-zA-Z][^a-zA-Z]*/g) ?? []) {
    const t = cmd[0]
    const up = t.toUpperCase()
    const n = (cmd.slice(1).match(NUM) ?? []).map(Number)
    const P = (dx, dy) => (t === up ? [dx, dy] : [x + dx, y + dy])
    switch (up) {
      case 'M': { const [px, py] = P(n[0], n[1]); x = mx = px; y = my = py; pts.push([px, py]); break }
      case 'L': { const [px, py] = P(n[0], n[1]); x = px; y = py; pts.push([px, py]); break }
      case 'H': { const px = t === up ? n[0] : x + n[0]; x = px; pts.push([px, y]); break }
      case 'V': { const py = t === up ? n[0] : y + n[0]; y = py; pts.push([x, py]); break }
      case 'C': for (let i = 0; i < 6; i += 2) pts.push(P(n[i], n[i + 1])); [x, y] = pts[pts.length - 1]; break
      case 'S': case 'Q': for (let i = 0; i < 4; i += 2) pts.push(P(n[i], n[i + 1])); [x, y] = pts[pts.length - 1]; break
      case 'T': { const [px, py] = P(n[0], n[1]); x = px; y = py; pts.push([px, py]); break }
      // rx ry rotation large-arc sweep x y — only the endpoint is a position.
      case 'A': { const [px, py] = P(n[5], n[6]); x = px; y = py; pts.push([px, py]); break }
      case 'Z': x = mx; y = my; break
    }
  }
  return pts
}

describe('the panel menu icon rule (AP 4.3)', () => {
  it('names every icon the set has', () => {
    const exported = new Set(Object.keys(icons))
    for (const name of MENU_ICONS) expect(exported.has(name), `${name} is gone`).toBe(true)
    // And nothing menu-shaped hides outside the list: every export that is a
    // 16×16 currentColor svg belongs to it. OverlayThumbnail takes its colours
    // as props and is not one — it is rendered with them, like the panel does.
    for (const name of exported) {
      const props = name === 'OverlayThumbnail'
        ? { kmColor: '#0f766e', kmOtherColor: '#78716c', kmJumpColor: '#b3261e' }
        : {}
      const markup = renderToStaticMarkup(icons[name](props))
      if (markup.includes('viewBox="0 0 16 16"') && markup.includes('currentColor')) {
        expect(MENU_ICONS, `${name} is a menu icon but not in MENU_ICONS`).toContain(name)
      }
    }
  })

  for (const name of MENU_ICONS) {
    describe(name, () => {
      const markup = renderToStaticMarkup(icons[name]())

      it('is 16 × 16 with the one stroke width and currentColor', () => {
        expect(markup).toContain(`width="${SIZE}"`)
        expect(markup).toContain(`height="${SIZE}"`)
        expect(markup).toContain('viewBox="0 0 16 16"')
        expect(markup).toContain('stroke="currentColor"')
        expect(markup).toContain(`stroke-width="${STROKE}"`)
        // No colour of its own anywhere — the button decides. `none` is not a
        // colour: a filled shape states it to opt out of the root stroke.
        expect(markup).not.toMatch(/stroke="(?!currentColor|none)[a-z]/)
        expect(markup).not.toMatch(/fill="(?!currentColor|none)[a-z]/)
      })

      it('draws every node with the one radius', () => {
        // Not every icon has nodes — but every node there is carries the one
        // radius, filled, without a stroke of its own.
        for (const node of markup.match(/<circle [^>]*>/g) ?? []) {
          expect(node, `${name}: ${node}`).toContain(`r="${NODE}"`)
          expect(node, `${name}: ${node}`).toContain('fill="currentColor"')
        }
      })

      it('stays inside the box', () => {
        // A path point may reach the edge — the stroke may overhang by half
        // its width, that is how a line ends. A node must be fully visible.
        const pointLimit = SIZE - STROKE / 2
        const nodeLimit = SIZE - NODE
        const positions = [
          ...pathPositions([...markup.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]).join(' ')),
          ...[...markup.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]),
          // A rect states its corners through x/y/width/height.
          ...[...markup.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/g)]
            .map((m) => [[Number(m[1]), Number(m[2])], [Number(m[1]) + Number(m[3]), Number(m[2]) + Number(m[4])]]
            .flat()),
        ]
        expect(positions.length, `${name} states no position`).toBeGreaterThan(0)
        for (const [px, py] of positions) {
          expect(px, `${name}: x ${px}`).toBeGreaterThanOrEqual(STROKE / 2)
          expect(px, `${name}: x ${px}`).toBeLessThanOrEqual(pointLimit)
          expect(py, `${name}: y ${py}`).toBeGreaterThanOrEqual(STROKE / 2)
          expect(py, `${name}: y ${py}`).toBeLessThanOrEqual(pointLimit)
        }
        for (const m of markup.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) {
          expect(Number(m[1]), `${name}: node x ${m[1]}`).toBeGreaterThanOrEqual(NODE)
          expect(Number(m[1]), `${name}: node x ${m[1]}`).toBeLessThanOrEqual(nodeLimit)
          expect(Number(m[2]), `${name}: node y ${m[2]}`).toBeGreaterThanOrEqual(NODE)
          expect(Number(m[2]), `${name}: node y ${m[2]}`).toBeLessThanOrEqual(nodeLimit)
        }
      })
    })
  }
})

// The panels compose, they do not draw — that is what keeps the set uniform.
// A new panel reaches for icons.jsx instead of pasting an svg.
const panelsDir = join(dirname(fileURLToPath(import.meta.url)), 'panels')

describe('the panels carry no inline svg', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name)
      return e.isDirectory() ? walk(p) : [p]
    })

  const files = walk(panelsDir).filter((f) => /\.(jsx|js)$/.test(f))
  it('found the panels', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const file of files) {
    it(`${file.replace(panelsDir + '/', '')} has no <svg>`, () => {
      expect(readFileSync(file, 'utf8')).not.toMatch(/<svg[\s>]/)
    })
  }
})
