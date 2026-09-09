import { canonicalCbor, digestDomain } from '@knolo/core';

const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;
const MODEL_SPLITS = new Set(['calibration', 'development', 'test']);

export type ReflexAblationObservationV1 = {
  schema: 'knolo.reflex.ablation-observation/v1';
  id: string;
  modelId: string;
  modelRevision: string;
  family: string;
  queryId: string;
  datasetSplit: 'calibration' | 'development' | 'test';
  atomIds: string[];
  success: boolean;
  policyViolation?: boolean;
  schemaValid?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  ttftMs?: number;
  latencyMs?: number;
  memoryBytes?: number;
  energyJoules?: number;
};

export type ReflexCalibrationConfigV1 = {
  modelId: string;
  modelRevision: string;
  family: string;
  candidateAtomIds: string[];
  interactionAtomPairs?: Array<[string, string]>;
  datasetSplitDigest: string;
  l2?: number;
  maxIterations?: number;
  convergenceTolerance?: number;
  minObservations?: number;
};

export type ReflexCalibrationFeatureV1 = {
  name: string;
  kind: 'intercept' | 'atom' | 'interaction';
  atomIds: string[];
  coefficient: number;
  standardError: number;
};

export type ReflexCalibrationResultV1 = {
  schema: 'knolo.reflex.calibration/v1';
  modelId: string;
  modelRevision: string;
  family: string;
  datasetSplitDigest: string;
  candidateAtomIds: string[];
  observations: number;
  successes: number;
  iterations: number;
  converged: boolean;
  features: ReflexCalibrationFeatureV1[];
  coefficientDigest: string;
  calibrationDigest: string;
};

/**
 * Fit a finite logistic surrogate from frozen ablation observations. This is
 * an empirical selection aid, not a causal or global model-quality claim.
 */
export function calibrateReflexCapabilityV1(
  observations: ReflexAblationObservationV1[],
  config: ReflexCalibrationConfigV1
): ReflexCalibrationResultV1 {
  validateConfig(config);
  if (!Array.isArray(observations) || observations.length === 0)
    throw new Error('Reflex calibration observations are required.');
  const sorted = observations
    .slice()
    .sort((left, right) => compareBytes(left.id, right.id));
  const ids = new Set<string>();
  for (const observation of sorted) {
    validateObservation(observation);
    if (ids.has(observation.id))
      throw new Error(`Duplicate calibration observation: ${observation.id}`);
    ids.add(observation.id);
    if (
      observation.modelId !== config.modelId ||
      observation.modelRevision !== config.modelRevision ||
      observation.family !== config.family
    )
      throw new Error(
        `Calibration observation scope mismatch: ${observation.id}`
      );
    if (observation.datasetSplit !== 'calibration')
      throw new Error(
        `Calibration requires calibration observations: ${observation.id}`
      );
    const candidateSet = new Set(config.candidateAtomIds);
    if (observation.atomIds.some((atomId) => !candidateSet.has(atomId)))
      throw new Error(
        `Calibration observation has an unknown atom: ${observation.id}`
      );
  }
  if (new Set(sorted.map((observation) => observation.success)).size < 2)
    throw new Error(
      'Calibration requires both successful and failed observations.'
    );
  const pairs = normalizePairs(config);
  const features = buildFeatures(config.candidateAtomIds, pairs);
  const minObservations =
    config.minObservations ?? Math.max(8, features.length + 1);
  if (sorted.length < minObservations)
    throw new Error(
      `Calibration requires at least ${minObservations} observations; received ${sorted.length}.`
    );
  const matrix = sorted.map((observation) =>
    featureVector(observation, config.candidateAtomIds, pairs)
  );
  const labels = sorted.map((observation) => (observation.success ? 1 : 0));
  const fit = fitLogistic(matrix, labels, config);
  const resultFeatures = features.map((feature, index) => ({
    ...feature,
    coefficient: fit.weights[index],
    standardError: fit.standardErrors[index],
  }));
  const coefficientDigest = digestDomain(
    'reflex-calibration-coefficients',
    canonicalCbor(
      resultFeatures.map((feature) => ({
        name: feature.name,
        kind: feature.kind,
        atomIds: feature.atomIds,
        coefficient: numberToken(feature.coefficient),
        standardError: numberToken(feature.standardError),
      })) as never
    )
  );
  const calibrationDigest = digestDomain(
    'reflex-calibration',
    canonicalCbor({
      version: 1,
      modelId: config.modelId,
      modelRevision: config.modelRevision,
      family: config.family,
      datasetSplitDigest: config.datasetSplitDigest,
      observationIds: sorted.map((observation) => observation.id),
      candidateAtomIds: config.candidateAtomIds.slice().sort(compareBytes),
      interactionAtomPairs: pairs,
      l2: numberToken(config.l2 ?? 0.01),
      coefficientDigest,
    } as never)
  );
  return {
    schema: 'knolo.reflex.calibration/v1',
    modelId: config.modelId,
    modelRevision: config.modelRevision,
    family: config.family,
    datasetSplitDigest: config.datasetSplitDigest,
    candidateAtomIds: config.candidateAtomIds.slice().sort(compareBytes),
    observations: sorted.length,
    successes: labels.reduce<number>((sum, value) => sum + value, 0),
    iterations: fit.iterations,
    converged: fit.converged,
    features: resultFeatures,
    coefficientDigest,
    calibrationDigest,
  };
}

function validateConfig(config: ReflexCalibrationConfigV1): void {
  for (const field of ['modelId', 'modelRevision', 'family']) {
    if (
      typeof config[field as keyof ReflexCalibrationConfigV1] !== 'string' ||
      !(config[field as keyof ReflexCalibrationConfigV1] as string).trim()
    )
      throw new Error(`Calibration ${field} is required.`);
  }
  if (
    !Array.isArray(config.candidateAtomIds) ||
    !config.candidateAtomIds.length
  )
    throw new Error('Calibration candidateAtomIds are required.');
  if (new Set(config.candidateAtomIds).size !== config.candidateAtomIds.length)
    throw new Error('Calibration candidateAtomIds must be unique.');
  if (!DIGEST_PATTERN.test(config.datasetSplitDigest))
    throw new Error('Calibration datasetSplitDigest must be a digest.');
  if (config.candidateAtomIds.length > 20)
    throw new Error('Calibration candidateAtomIds are capped at 20.');
  if (config.l2 !== undefined && (!Number.isFinite(config.l2) || config.l2 < 0))
    throw new Error('Calibration l2 must be non-negative and finite.');
  for (const [name, value] of [
    ['maxIterations', config.maxIterations],
    ['minObservations', config.minObservations],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0))
      throw new Error(`Calibration ${name} must be a positive integer.`);
  }
  if (
    config.convergenceTolerance !== undefined &&
    (!Number.isFinite(config.convergenceTolerance) ||
      config.convergenceTolerance <= 0)
  )
    throw new Error('Calibration convergenceTolerance must be positive.');
}

function validateObservation(observation: ReflexAblationObservationV1): void {
  if (
    !observation ||
    observation.schema !== 'knolo.reflex.ablation-observation/v1'
  )
    throw new Error('Invalid Reflex ablation observation schema.');
  for (const field of ['id', 'modelId', 'modelRevision', 'family', 'queryId']) {
    if (
      typeof observation[field as keyof ReflexAblationObservationV1] !==
        'string' ||
      !(
        observation[field as keyof ReflexAblationObservationV1] as string
      ).trim()
    )
      throw new Error(`Ablation observation ${field} is required.`);
  }
  if (!MODEL_SPLITS.has(observation.datasetSplit))
    throw new Error(`Invalid ablation observation split: ${observation.id}`);
  if (
    !Array.isArray(observation.atomIds) ||
    new Set(observation.atomIds).size !== observation.atomIds.length ||
    observation.atomIds.some((atomId) => typeof atomId !== 'string')
  )
    throw new Error(`Invalid ablation atom IDs: ${observation.id}`);
  if (typeof observation.success !== 'boolean')
    throw new Error(
      `Ablation observation success is required: ${observation.id}`
    );
  for (const field of [
    'inputTokens',
    'outputTokens',
    'ttftMs',
    'latencyMs',
    'memoryBytes',
    'energyJoules',
  ] as const) {
    const value = observation[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error(`Invalid ablation metric ${field}: ${observation.id}`);
  }
}

function normalizePairs(
  config: ReflexCalibrationConfigV1
): Array<[string, string]> {
  const candidates = new Set(config.candidateAtomIds);
  const pairs = (config.interactionAtomPairs ?? []).map(([left, right]) => {
    if (left === right || !candidates.has(left) || !candidates.has(right))
      throw new Error('Calibration interaction references an unknown atom.');
    return [left, right].sort(compareBytes) as [string, string];
  });
  const unique = new Map(pairs.map((pair) => [pair.join('\0'), pair]));
  return [...unique.values()].sort((left, right) =>
    compareBytes(left.join('\0'), right.join('\0'))
  );
}

function buildFeatures(
  atomIds: string[],
  pairs: Array<[string, string]>
): Array<Omit<ReflexCalibrationFeatureV1, 'coefficient' | 'standardError'>> {
  const sorted = atomIds.slice().sort(compareBytes);
  return [
    { name: 'intercept', kind: 'intercept', atomIds: [] },
    ...sorted.map((atomId) => ({
      name: `atom:${atomId}`,
      kind: 'atom' as const,
      atomIds: [atomId],
    })),
    ...pairs.map(([left, right]) => ({
      name: `interaction:${left}+${right}`,
      kind: 'interaction' as const,
      atomIds: [left, right],
    })),
  ];
}

function featureVector(
  observation: ReflexAblationObservationV1,
  atomIds: string[],
  pairs: Array<[string, string]>
): number[] {
  const selected = new Set(observation.atomIds);
  const sorted = atomIds.slice().sort(compareBytes);
  return [
    1,
    ...sorted.map((atomId) => (selected.has(atomId) ? 1 : 0)),
    ...pairs.map(([left, right]) =>
      selected.has(left) && selected.has(right) ? 1 : 0
    ),
  ];
}

function fitLogistic(
  matrix: number[][],
  labels: number[],
  config: ReflexCalibrationConfigV1
): {
  weights: number[];
  standardErrors: number[];
  iterations: number;
  converged: boolean;
} {
  const dimension = matrix[0].length;
  const weights = new Array(dimension).fill(0) as number[];
  const l2 = config.l2 ?? 0.01;
  const maxIterations = config.maxIterations ?? 100;
  const tolerance = config.convergenceTolerance ?? 1e-7;
  let hessian = identity(dimension);
  let converged = false;
  let iterations = 0;
  for (iterations = 1; iterations <= maxIterations; iterations++) {
    const gradient = new Array(dimension).fill(0) as number[];
    hessian = Array.from({ length: dimension }, () =>
      new Array(dimension).fill(0)
    );
    for (let row = 0; row < matrix.length; row++) {
      const probability = sigmoid(dot(matrix[row], weights));
      const variance = Math.max(probability * (1 - probability), 1e-8);
      const residual = probability - labels[row];
      for (let i = 0; i < dimension; i++) {
        gradient[i] += matrix[row][i] * residual;
        for (let j = 0; j < dimension; j++)
          hessian[i][j] += matrix[row][i] * variance * matrix[row][j];
      }
    }
    for (let i = 1; i < dimension; i++) {
      gradient[i] += l2 * weights[i];
      hessian[i][i] += l2;
    }
    const step = solveLinearSystem(hessian, gradient);
    let maxStep = 0;
    for (let i = 0; i < dimension; i++) {
      weights[i] -= step[i];
      maxStep = Math.max(maxStep, Math.abs(step[i]));
    }
    if (maxStep <= tolerance) {
      converged = true;
      break;
    }
  }
  const inverse = invertMatrix(hessian);
  return {
    weights,
    standardErrors: inverse.map((row, index) =>
      Math.sqrt(Math.max(row[index], 0))
    ),
    iterations,
    converged,
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < vector.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < vector.length; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column]))
        pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) continue;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    for (let j = column; j <= vector.length; j++)
      augmented[column][j] /= divisor;
    for (let row = 0; row < vector.length; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= vector.length; j++)
        augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row, index) => row[vector.length] ?? 0);
}

function invertMatrix(matrix: number[][]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [
    ...row,
    ...Array.from({ length: size }, (_, column) => (column === index ? 1 : 0)),
  ]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++)
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column]))
        pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) continue;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];
    const divisor = augmented[column][column];
    for (let j = 0; j < size * 2; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = 0; j < size * 2; j++)
        augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map((row) => row.slice(size));
}

function identity(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row === column ? 1 : 0))
  );
}

function sigmoid(value: number): number {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function numberToken(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(17) : 'non-finite';
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
