/** A gradient in ‰, signed — a rise is written with its plus, a level stretch as 0 — in the language's digits (`num`). */
export const gradeLabel = (perMille, num) => {
  const v = Number(perMille.toFixed(2)) || 0   // ... and never as "-0.00"
  return `${v > 0 ? '+' : ''}${num(v, { digits: 2 })} ‰`
}
