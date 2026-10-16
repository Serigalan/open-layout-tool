// splice — "Zwei Gleise zusammenfügen": the construction joining two track ends
// (the JavaScript port of the service's splice.py), in a worker.
//
// This file is the module's public face: code outside src/core/utils/splice/
// imports from here and nowhere else (tools/modules.mjs). What is not listed is
// the module's own business. See docs/modules/splice.md.

export { solveSpliceInWorker } from './spliceJob'
export { hasJumpError, spliceRemedies } from './spliceRemedies'
