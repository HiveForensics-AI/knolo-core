import { parseKiteContract, resolveKiteBounds } from './contract.js';
import { certificateFromResult } from './certificate.js';
import { dependenciesFromDerivation } from './dependencies.js';
import { deriveKiteWorld } from './derivation.js';
import { discoverObligation, mountKiteImage } from './discover.js';
import { KiteError } from './errors.js';
import {
  parseAsOf,
  parseKiteChanges,
  parseKiteCompleteness,
  parseKiteRules,
  parseSemanticRoot,
} from './rules.js';
import {
  KITE_RESULT_FORMAT,
  KITE_WORLD_FORMAT,
  type KiteBounds,
  type KiteChangeSet,
  type KiteCompleteness,
  type KiteContract,
  type KiteRetrieval,
  type KiteRules,
  type KiteSessionResult,
  type KiteWorld,
} from './types.js';

export type KiteSession = {
  image: Uint8Array;
  contract: KiteContract;
  rules: KiteRules;
  completeness: KiteCompleteness;
  changes: KiteChangeSet;
  bounds: KiteBounds;
  semanticRoot: string | null;
};

export function createKiteSession(input: {
  image: Uint8Array | ArrayBuffer;
  graph?: unknown;
  contract: unknown;
  rules: unknown;
  completeness?: unknown;
  changes?: unknown;
  bounds?: unknown;
}): KiteSession {
  const contract = parseKiteContract(input.contract);
  const rules = parseKiteRules(input.rules, contract);
  const completeness = parseKiteCompleteness(input.completeness, rules);
  const changes = parseKiteChanges(input.changes, contract);
  const bounds = resolveKiteBounds(input.bounds);
  const image = copyImage(input.image);
  mountKiteImage(image);
  return {
    image,
    contract,
    rules,
    completeness,
    changes,
    bounds,
    semanticRoot: parseSemanticRoot(input.graph),
  };
}

export async function evaluateKiteSession(
  session: KiteSession,
  options: { question?: string; asOf?: string | null } = {}
): Promise<KiteSessionResult> {
  const question = options.question ?? session.contract.question;
  if (question !== session.contract.question) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Question does not match the contract.',
      'question'
    );
  }
  const asOf = parseAsOf(options.asOf);
  const mounted = mountKiteImage(session.image);
  const objectCount = mounted.v5?.objects.length ?? mounted.byId.size;
  if (objectCount > session.bounds.maxGraphNodes) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Image object count exceeds maxGraphNodes.',
      'bounds.maxGraphNodes'
    );
  }
  if (session.contract.obligations.length > session.bounds.maxRetrievals) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Obligation count exceeds the retrieval bound.',
      'bounds.maxRetrievals'
    );
  }
  const met = [];
  const unmet = [];
  const retrievals: KiteRetrieval[] = [];
  const obligations = [];
  for (const obligation of session.contract.obligations) {
    const found = await discoverObligation(mounted, obligation);
    const row = {
      id: obligation.id,
      kind: obligation.kind,
      hitIds: found.hitIds,
    };
    obligations.push({
      id: obligation.id,
      kind: obligation.kind,
      met: found.hitIds.length > 0,
      hitIds: found.hitIds,
      sources: found.sources,
    });
    if (found.hitIds.length > 0) {
      met.push(row);
      continue;
    }
    unmet.push({ id: row.id, kind: row.kind, hitIds: [] });
    retrievals.push(found.retrieval);
  }
  const world: KiteWorld = {
    format: KITE_WORLD_FORMAT,
    question,
    asOf,
    stateRoot: mounted.image.stateRoot,
    semanticRoot: session.semanticRoot,
    obligations,
    rules: session.rules,
    completeness: session.completeness,
    changes: session.changes.changes,
    bounds: session.bounds,
  };
  const derivation = deriveKiteWorld(world);
  const dependencies = dependenciesFromDerivation(derivation);
  const result: KiteSessionResult = {
    format: KITE_RESULT_FORMAT,
    verdict: derivation.verdict,
    question,
    asOf,
    stateRoot: world.stateRoot,
    semanticRoot: world.semanticRoot,
    met,
    unmet,
    retrievals,
    worldsChecked: derivation.worldsChecked,
    agrees: derivation.agrees,
    witness: derivation.witness ? { changeIds: [...derivation.witness] } : null,
    bounds: {
      ...session.bounds,
      variantsChecked: derivation.variantsChecked,
      counterfactualChanges: derivation.counterfactualChanges,
    },
    certificate: null,
    dependencies,
  };
  result.certificate = certificateFromResult(result, derivation);
  return result;
}

function copyImage(image: Uint8Array | ArrayBuffer): Uint8Array {
  if (image instanceof Uint8Array) return new Uint8Array(image);
  return new Uint8Array(image);
}
