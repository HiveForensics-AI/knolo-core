/**
 * CEG authoring for `@knolo/core/kar/authoring`.
 *
 * Compiles CEG Source into the KarSidecarV1 that KAR evaluates. This module
 * does not retrieve evidence and does not change `kar-1-research-1`.
 * `@knolo/core/experimental/kar/authoring` remains available for the V6 cycle.
 */

import { CEG_LIMITS, interpretCegSource, parseCegSource } from '../../experimental/kar/authoring/index.js';

export {
  CEG_SOURCE_VERSION,
  createCegSource,
  compileCegSource,
  lintCegSource,
  diffCegGraphs,
  parseCegSource,
  emitCegSourceJson,
  emitCegSourceYaml,
  cegNodeId,
  domainPackRoot,
  interpretDomainPack,
  inspectDomainPack,
  testDomainFixtures,
} from '../../experimental/kar/authoring/index.js';
export type {
  CegCompilation,
  CegDiagnostic,
  CegSourceV1,
  DomainPackV1,
  PolicyClass,
} from '../../experimental/kar/authoring/index.js';

/** Validate one CEG Source document or YAML/JSON text. This does not compile a sidecar. */
export function validateCegSource(source: unknown): ReturnType<typeof interpretCegSource> {
  if (typeof source === 'string') return parseCegSource(source);
  return interpretCegSource(source, CEG_LIMITS);
}
