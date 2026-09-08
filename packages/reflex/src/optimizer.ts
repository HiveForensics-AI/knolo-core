export type ReflexMRSAtomV1 = {
  id: string;
  tokenCost: number;
  contribution: number;
  requires?: string[];
  conflicts?: string[];
};

export type ReflexMRSInteractionV1 = {
  atomIds: [string, string];
  contribution: number;
};

export type ReflexMRSProblemV1 = {
  atoms: ReflexMRSAtomV1[];
  requiredAtomIds?: string[];
  intercept: number;
  successThreshold: number;
  interactions?: ReflexMRSInteractionV1[];
  maxTokenCost?: number;
  maxSearchAtoms?: number;
};

export type ReflexMRSResultV1 = {
  schema: 'knolo.reflex.mrs-result/v1';
  status: 'optimal' | 'infeasible' | 'search_limit';
  selectedAtomIds: string[];
  tokenCost: number | null;
  predictedSuccess: number | null;
  threshold: number;
  enumeratedSubsets: number;
  reason?: string;
};

/**
 * Solve the finite surrogate MRS problem exactly by exhaustive enumeration.
 * `optimal` means every subset in the declared candidate pool was searched;
 * it is not a claim about real-model quality or global behavior outside that
 * pool. Larger research problems should use a separately verified solver.
 */
export function optimizeMinimumReflexSetV1(
  problem: ReflexMRSProblemV1
): ReflexMRSResultV1 {
  validateProblem(problem);
  const atoms = problem.atoms
    .slice()
    .sort((left, right) => compareBytes(left.id, right.id));
  const maxSearchAtoms = problem.maxSearchAtoms ?? 20;
  if (atoms.length > maxSearchAtoms) {
    return {
      schema: 'knolo.reflex.mrs-result/v1',
      status: 'search_limit',
      selectedAtomIds: [],
      tokenCost: null,
      predictedSuccess: null,
      threshold: problem.successThreshold,
      enumeratedSubsets: 0,
      reason: `Candidate pool has ${atoms.length} atoms; exact search limit is ${maxSearchAtoms}.`,
    };
  }

  const indexById = new Map(atoms.map((atom, index) => [atom.id, index]));
  const required = new Set(problem.requiredAtomIds ?? []);
  const interactions = (problem.interactions ?? []).map((interaction) => ({
    ...interaction,
    left: indexById.get(interaction.atomIds[0]) as number,
    right: indexById.get(interaction.atomIds[1]) as number,
  }));
  const subsetCount = 2 ** atoms.length;
  let enumeratedSubsets = 0;
  let best: {
    atomIds: string[];
    tokenCost: number;
    predictedSuccess: number;
  } | null = null;

  for (let mask = 0; mask < subsetCount; mask++) {
    enumeratedSubsets++;
    const selected = atoms.filter((_, index) => (mask & (1 << index)) !== 0);
    const selectedIds = new Set(selected.map((atom) => atom.id));
    if ([...required].some((id) => !selectedIds.has(id))) continue;
    if (
      selected.some((atom) =>
        (atom.requires ?? []).some((dependency) => !selectedIds.has(dependency))
      )
    )
      continue;
    if (
      selected.some((atom) =>
        (atom.conflicts ?? []).some((conflict) => selectedIds.has(conflict))
      )
    )
      continue;
    const tokenCost = selected.reduce((sum, atom) => sum + atom.tokenCost, 0);
    if (problem.maxTokenCost !== undefined && tokenCost > problem.maxTokenCost)
      continue;
    const logit =
      problem.intercept +
      selected.reduce((sum, atom) => sum + atom.contribution, 0) +
      interactions.reduce(
        (sum, interaction) =>
          sum +
          (selectedIds.has(atoms[interaction.left].id) &&
          selectedIds.has(atoms[interaction.right].id)
            ? interaction.contribution
            : 0),
        0
      );
    const predictedSuccess = sigmoid(logit);
    if (predictedSuccess + Number.EPSILON < problem.successThreshold) continue;
    const atomIds = selected.map((atom) => atom.id);
    if (
      best === null ||
      tokenCost < best.tokenCost ||
      (tokenCost === best.tokenCost && atomIds.length < best.atomIds.length) ||
      (tokenCost === best.tokenCost &&
        atomIds.length === best.atomIds.length &&
        compareBytes(atomIds.join('\0'), best.atomIds.join('\0')) < 0)
    ) {
      best = { atomIds, tokenCost, predictedSuccess };
    }
  }

  return best
    ? {
        schema: 'knolo.reflex.mrs-result/v1',
        status: 'optimal',
        selectedAtomIds: best.atomIds,
        tokenCost: best.tokenCost,
        predictedSuccess: best.predictedSuccess,
        threshold: problem.successThreshold,
        enumeratedSubsets,
      }
    : {
        schema: 'knolo.reflex.mrs-result/v1',
        status: 'infeasible',
        selectedAtomIds: [],
        tokenCost: null,
        predictedSuccess: null,
        threshold: problem.successThreshold,
        enumeratedSubsets,
        reason: 'No feasible subset in the declared candidate pool.',
      };
}

function validateProblem(problem: ReflexMRSProblemV1): void {
  if (!problem || !Array.isArray(problem.atoms))
    throw new Error('MRS atoms are required.');
  if (!Number.isFinite(problem.intercept))
    throw new Error('MRS intercept must be finite.');
  if (
    !Number.isFinite(problem.successThreshold) ||
    !(problem.successThreshold > 0 && problem.successThreshold < 1)
  )
    throw new Error('MRS success threshold must be between 0 and 1.');
  if (
    problem.maxSearchAtoms !== undefined &&
    (!Number.isInteger(problem.maxSearchAtoms) || problem.maxSearchAtoms < 0)
  )
    throw new Error('MRS maxSearchAtoms must be a non-negative integer.');
  const ids = new Set<string>();
  for (const atom of problem.atoms) {
    if (!atom.id || ids.has(atom.id))
      throw new Error('MRS atom IDs must be unique.');
    if (!Number.isFinite(atom.tokenCost) || atom.tokenCost < 0)
      throw new Error(`Invalid token cost for MRS atom: ${atom.id}`);
    if (!Number.isFinite(atom.contribution))
      throw new Error(`Invalid contribution for MRS atom: ${atom.id}`);
    ids.add(atom.id);
  }
  for (const id of problem.requiredAtomIds ?? []) {
    if (!ids.has(id)) throw new Error(`MRS required atom is missing: ${id}`);
  }
  for (const atom of problem.atoms) {
    for (const relation of [
      ...(atom.requires ?? []),
      ...(atom.conflicts ?? []),
    ]) {
      if (!ids.has(relation))
        throw new Error(`MRS atom relation is missing: ${relation}`);
    }
  }
  for (const interaction of problem.interactions ?? []) {
    if (
      interaction.atomIds[0] === interaction.atomIds[1] ||
      !ids.has(interaction.atomIds[0]) ||
      !ids.has(interaction.atomIds[1]) ||
      !Number.isFinite(interaction.contribution)
    )
      throw new Error('Invalid MRS interaction.');
  }
  if (
    problem.maxTokenCost !== undefined &&
    (!Number.isFinite(problem.maxTokenCost) || problem.maxTokenCost < 0)
  )
    throw new Error('MRS maxTokenCost must be non-negative and finite.');
}

function sigmoid(value: number): number {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

function compareBytes(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] !== rightBytes[index])
      return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}
