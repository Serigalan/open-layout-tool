// Axes of the drawing overlays: a step that keeps the labels apart, and the
// ticks it puts into a range.

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]

/** The smallest round step at least `minPx` apart at `pxPerUnit`. */
export const niceStep = (minPx, pxPerUnit) => STEPS.find(s => s * pxPerUnit >= minPx) ?? STEPS[STEPS.length - 1]

/** How many decimals a label on that step needs. */
export const stepDecimals = (step) => (step < 1 ? (step < 0.2 ? 2 : 1) : 0)

/** Every multiple of `step` from `from` to `to`. */
export function ticks(from, to, step) {
  const out = []
  for (let n = Math.ceil(from / step - 1e-9); n * step <= to + 1e-9; n++) out.push(Number((n * step).toFixed(10)))
  return out
}
