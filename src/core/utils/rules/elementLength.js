import { catalogLimit } from '../regelkatalog'

/**
 * l_min of LP.EL.01 for an element of design speed `v` [m] — or null where the
 * catalogue gives none (no speed, or one below its table). What a turnout may
 * leave of the element it is laid into (switch connection) and the shortest
 * arc the splice's search for the largest radius may insert.
 */
export function minElementLength(v) {
  if (!(v > 0)) return null
  try {
    return catalogLimit('LP.EL.01', 'l_min', { 'element.design_speed': v, 'element.length': 0 })
  } catch {
    return null
  }
}
