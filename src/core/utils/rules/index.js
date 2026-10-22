// rules — DB Ril 800.0110 as a catalogue of rules in a small expression
// language, its evaluation, and the alignment checks built on it (cant, speed,
// element length, transition length, LP.*).
//
// This file is the module's public face: code outside src/core/utils/rules/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/rules.md.

export {
  AUTO_CANT_MODEL, CANT_STEP, cantDefLevel, cantExceedsLimit, cantExceptionFields,
  cantExceptionOf, cantFromInput, cantLimit, cantSign, clampCant, computeAutoC, computeCantDef,
  computeCantDefSigned, computeSwitchCant, limitCantDef, MAX_CANT, MAX_SWITCH_CANT,
  MAX_SWITCH_CANT_DEF, MAX_SWITCH_CANT_EXCEPTION, regelCant, roundCant,
  switchCantError, worstCantOf,
} from './cant'
export { bundledCatalogHash } from './catalogHash'
export { BUNDLED_KATALOG_VERSION, flattenPhysics, GRENZWERTE, optimizerLimitRows, PHYSICS } from './constraintsView'
export { comparisonRadiusLimits, minElementLength } from './elementLength'
export {
  CATALOG_ID, catalogLimit, evaluateRules, KATALOG, ruleById, rulesForScope,
  severityLabelKey, severityRank, worstSeverity,
} from './regelkatalog'
export { CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'
export { fieldFindings } from './ruleFields'
export { governing, maxSpeeds, ruleMaxSpeedsOf, SPEED_STEP } from './speed'
export {
  connectTransitionLengths, lengthRuleFormula, transitionChain, transitionHasError,
  transitionLengths,
} from './transitionLength'
export { boundaryScope, checkTrack, endRun, hasRuleError, runBeside } from './trassierungCheck'
