import {
  completenessGapIds,
  coveredObligationIds,
  negativeCollections,
  openRequirementIds,
} from './completeness.js';
import { applyChanges, combinations, subsetCount } from './counterfactual.js';
import { invarianceRoot } from './invariance.js';
import {
  KITE_VERDICTS,
  type KiteDerivation,
  type KiteVerdict,
  type KiteWorld,
  type KiteWorldLabel,
  type KiteWorldStep,
} from './types.js';

const SCOPE: Record<KiteWorldLabel, Exclude<KiteVerdict, 'BOUND_EXCEEDED'>> = {
  SUPPORTED_CLOSED: 'WARRANTED_IN_SCOPE',
  REFUTED: 'REFUTED_IN_SCOPE',
  SUPPORTED_OPEN_WORLD: 'SUPPORTED_OPEN_WORLD',
  CONFLICTED: 'CONFLICTED',
  UNDERDETERMINED: 'UNDERDETERMINED',
};

export function labelKiteWorld(
  met: ReadonlySet<string>,
  world: KiteWorld
): KiteWorldLabel {
  const support = world.rules.support.filter((id) => met.has(id));
  const oppose = world.rules.oppose.filter((id) => met.has(id));
  const unmet = new Set(
    world.obligations.filter((item) => !met.has(item.id)).map((item) => item.id)
  );
  const covered = new Set(
    coveredObligationIds(world.rules.completeness, world.completeness, unmet)
  );
  const openRequire = openRequirementIds(world.rules.require, met, covered);
  if (oppose.length > 0 && support.length === 0) return 'REFUTED';
  if (openRequire.length > 0) return 'UNDERDETERMINED';
  const paired = world.rules.conflicts.some(
    (pair) => met.has(pair.left) && met.has(pair.right)
  );
  if ((support.length > 0 && oppose.length > 0) || paired) return 'CONFLICTED';
  const knownAbsent = world.rules.require.filter(
    (id) => !met.has(id) && covered.has(id)
  );
  if (knownAbsent.length > 0) return 'REFUTED';
  if (
    support.length > 0 &&
    completenessGapIds(world.rules.completeness, world.completeness).length > 0
  ) {
    return 'SUPPORTED_OPEN_WORLD';
  }
  if (support.length > 0) return 'SUPPORTED_CLOSED';
  return 'UNDERDETERMINED';
}

export function deriveKiteWorld(world: KiteWorld): KiteDerivation {
  const obligationIds = world.obligations.map((item) => item.id).sort();
  const sourcePartitions = [
    ...new Set(
      world.obligations
        .filter((item) => item.met)
        .flatMap((item) => item.sources)
    ),
  ].sort();
  const collections = negativeCollections(world.rules.completeness);
  const count = subsetCount(
    world.changes.length,
    world.bounds.maxCounterfactualChanges
  );
  if (count > world.bounds.maxVariants) {
    return {
      verdict: 'BOUND_EXCEEDED',
      baseWorld: null,
      agrees: false,
      witness: null,
      worldsChecked: 0,
      worlds: [],
      invarianceRoot: null,
      negativeCollections: collections,
      obligationIds,
      sourcePartitions,
      variantsChecked: 0,
      counterfactualChanges: 0,
    };
  }
  const base = new Map(world.obligations.map((item) => [item.id, item.met]));
  const worlds: KiteWorldStep[] = [];
  const limit = Math.min(
    world.bounds.maxCounterfactualChanges,
    world.changes.length
  );
  for (let size = 0; size <= limit; size += 1) {
    for (const subset of combinations(world.changes, size)) {
      const met = applyChanges(base, subset);
      worlds.push({
        changeIds: subset.map((change) => change.id),
        label: labelKiteWorld(new Set(metIds(met)), world),
      });
    }
  }
  const baseWorld = worlds[0]?.label ?? 'UNDERDETERMINED';
  const agrees = worlds.every((step) => step.label === baseWorld);
  const flip = worlds.find((step) => step.label !== baseWorld);
  const witness = flip ? flip.changeIds : null;
  const verdict = scopeVerdict(baseWorld, agrees);
  return {
    verdict,
    baseWorld,
    agrees,
    witness,
    worldsChecked: worlds.length,
    worlds,
    invarianceRoot: invarianceRoot(world),
    negativeCollections: collections,
    obligationIds,
    sourcePartitions,
    variantsChecked: worlds.length,
    counterfactualChanges: witness ? witness.length : 0,
  };
}

export function isKiteVerdict(value: unknown): value is KiteVerdict {
  return (
    typeof value === 'string' &&
    (KITE_VERDICTS as readonly string[]).includes(value)
  );
}

function scopeVerdict(
  base: KiteWorldLabel,
  agrees: boolean
): Exclude<KiteVerdict, 'BOUND_EXCEEDED'> {
  if (agrees && base === 'SUPPORTED_CLOSED') return 'WARRANTED_IN_SCOPE';
  if (agrees && base === 'REFUTED') return 'REFUTED_IN_SCOPE';
  if (!agrees && base === 'SUPPORTED_CLOSED') return 'SUPPORTED_OPEN_WORLD';
  if (!agrees && base === 'REFUTED') return 'UNDERDETERMINED';
  return SCOPE[base];
}

function metIds(met: ReadonlyMap<string, boolean>): string[] {
  return [...met.entries()]
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);
}
