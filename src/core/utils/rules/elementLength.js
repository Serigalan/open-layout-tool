import { catalogLimit } from './regelkatalog'
import { CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'

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

const PHYSICS = { u0_factor: CANT_DEFICIENCY_COEFF }

/**
 * The comparison radius LP.KS.01 asks for at a curvature jump at design speed
 * `v` [m]: { reg, discretion } — the Regelwert and the Ermessensgrenze below
 * which a jump is an error. Null where the catalogue gives none.
 */
export function comparisonRadiusLimits(v) {
  if (!(v > 0)) return null
  const scope = {
    'physics.curvature_jump': true, 'prev.design_speed': v, 'next.design_speed': v, 'physics.r_w': 0,
  }
  try {
    return {
      reg: catalogLimit('LP.KS.01', 'reg', scope, { physics: PHYSICS }),
      discretion: catalogLimit('LP.KS.01', 'discretion', scope, { physics: PHYSICS }),
    }
  } catch {
    return null
  }
}
