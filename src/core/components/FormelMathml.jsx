/**
 * The set formula, drawn by the browser's own MathML — no library, MathML
 * Core renders in every current browser. physics.json states each formula
 * twice: this markup for drawing, and a bare `*_calc` expression a test
 * evaluates against the kernel (constraintsView.test.js, tests/verify.py) —
 * the calc side is never shown, only checked. Shared between PhysicsOverlay
 * and anything else that ever needs to draw one of physics.json's formulas.
 *
 * The markup comes from this repo's own physics.json, never from anything a
 * user typed or a service answered — which is what makes setting it as markup
 * safe here, and why nothing else in the app does the same.
 */
export default function FormelMathml({ mathml }) {
  if (!mathml) return null
  return <span className="constraints-math" dangerouslySetInnerHTML={{ __html: mathml }} />
}
