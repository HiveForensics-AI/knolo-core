import {
  canonicalCbor,
  digestDomain,
  knowledgePolicyRootV5,
  mountKnowledgeImageV5,
  type KnowledgeImageV5,
  type KnowledgeObjectV1,
  type KnowledgePolicyV1,
  type CborValue,
} from '@knolo/core';

export type EvidenceGateClaimModalityV1 =
  'fact' | 'instruction' | 'condition' | 'calculation';

export type EvidenceGateEvidenceRelationV1 =
  'supports' | 'contradicts' | 'qualifies';

export type EvidenceGateEvidenceReferenceV1 = {
  objectId: string;
  sourceDigest: string;
  start: number;
  end: number;
  relation: EvidenceGateEvidenceRelationV1;
};

export type EvidenceGateClaimV1 = {
  id: string;
  text: string;
  modality: EvidenceGateClaimModalityV1;
  evidence: EvidenceGateEvidenceReferenceV1[];
};

export type EvidenceGateConflictPolicyV1 = 'contested' | 'abstain';

export type EvidenceGatePolicyV1 = {
  knowledge: KnowledgePolicyV1;
  asOf?: string;
  minAuthority?: number;
  onConflict: EvidenceGateConflictPolicyV1;
  requireEvidenceFor: EvidenceGateClaimModalityV1[];
};

export type EvidenceGateLimitsV1 = {
  maxClaims: number;
  maxEvidencePerClaim: number;
  maxClaimTextBytes: number;
};

export type EvidenceGateRequestV1 = {
  image: KnowledgeImageV5 | ArrayBufferLike | Uint8Array;
  claims: EvidenceGateClaimV1[];
  policy: EvidenceGatePolicyV1;
  principal: string;
  limits?: Partial<EvidenceGateLimitsV1>;
};

export type EvidenceGateDecisionV1 =
  'supported' | 'refuted' | 'contested' | 'conditional' | 'unknown';

export type EvidenceGateClaimResultV1 = {
  id: string;
  claimRoot: string;
  decision: EvidenceGateDecisionV1;
  reasons: string[];
  evidence: string[];
};

export type EvidenceGateResultV1 = {
  version: 'evidence-gate-v1';
  stateRoot: string;
  policyRoot: string;
  evaluationRoot: string;
  principal: string;
  asOf?: string;
  limits: EvidenceGateLimitsV1;
  claims: EvidenceGateClaimResultV1[];
  overall: EvidenceGateDecisionV1;
  certificateRoot: string;
  replayHash: string;
};

export type EvidenceGateExplanationV1 = {
  overall: EvidenceGateDecisionV1;
  claims: Array<{
    id: string;
    decision: EvidenceGateDecisionV1;
    reasons: string[];
    evidence: Array<{
      key: string;
      objectId: string;
      text: string;
      relation: EvidenceGateEvidenceRelationV1;
    }>;
  }>;
};

export const DEFAULT_EVIDENCE_GATE_LIMITS_V1: EvidenceGateLimitsV1 = {
  maxClaims: 1000,
  maxEvidencePerClaim: 100,
  maxClaimTextBytes: 10_000,
};

export function evaluateEvidenceGateV1(
  request: EvidenceGateRequestV1
): EvidenceGateResultV1 {
  const image = resolveImage(request.image);
  const limits = normalizeLimits(request.limits);
  validateRequest(request, image, limits);
  const policyRoot = knowledgePolicyRootV5(request.policy.knowledge);
  if (policyRoot !== image.commit.policyRoot)
    throw new Error(
      `Evidence Gate policy root mismatch: expected ${image.commit.policyRoot}, got ${policyRoot}.`
    );

  const objectById = new Map(
    image.objects.map((object) => [object.id, object])
  );
  const claimResults = request.claims.map((claim) =>
    evaluateClaim(claim, objectById, request.policy, request.principal)
  );
  const overall = aggregateDecision(claimResults, request.policy.onConflict);
  const evaluationRoot = digestDomain(
    'evidence-policy',
    canonicalCbor({
      knowledgeRoot: policyRoot,
      onConflict: request.policy.onConflict,
      requireEvidenceFor: [...request.policy.requireEvidenceFor].sort(),
      ...(request.policy.asOf === undefined
        ? {}
        : { asOf: request.policy.asOf }),
      ...(request.policy.minAuthority === undefined
        ? {}
        : { minAuthority: request.policy.minAuthority }),
    } as unknown as CborValue)
  );
  const body = {
    version: 'evidence-gate-v1' as const,
    stateRoot: image.stateRoot,
    policyRoot,
    evaluationRoot,
    principal: request.principal,
    limits,
    claims: claimResults,
    overall,
    ...(request.policy.asOf === undefined ? {} : { asOf: request.policy.asOf }),
  };
  const certificateRoot = digestDomain(
    'evidence-certificate',
    canonicalCbor(body as unknown as CborValue)
  );
  const replayHash = digestDomain(
    'evidence-replay',
    canonicalCbor({
      ...body,
      certificateRoot,
    } as unknown as CborValue)
  );
  return { ...body, certificateRoot, replayHash };
}

export function verifyEvidenceGateV1(
  result: EvidenceGateResultV1,
  request: EvidenceGateRequestV1
): void {
  if (!result || result.version !== 'evidence-gate-v1')
    throw new Error('Unsupported Evidence Gate result version.');
  const expected = evaluateEvidenceGateV1(request);
  if (
    !bytesEqual(
      canonicalCbor(result as unknown as CborValue),
      canonicalCbor(expected as unknown as CborValue)
    )
  )
    throw new Error('Evidence Gate certificate or replay hash mismatch.');
}

export function explainEvidenceGateV1(
  result: EvidenceGateResultV1,
  request: EvidenceGateRequestV1
): EvidenceGateExplanationV1 {
  verifyEvidenceGateV1(result, request);
  const image = resolveImage(request.image);
  const objectById = new Map(
    image.objects.map((object) => [object.id, object])
  );
  return {
    overall: result.overall,
    claims: request.claims.map((claim, index) => ({
      id: claim.id,
      decision: result.claims[index].decision,
      reasons: result.claims[index].reasons,
      evidence: claim.evidence
        .filter((reference) =>
          result.claims[index].evidence.includes(evidenceKey(reference))
        )
        .map((reference) => {
          const object = objectById.get(reference.objectId);
          return {
            key: evidenceKey(reference),
            objectId: reference.objectId,
            text: object
              ? evidenceSpanTextV1(object, reference.start, reference.end)
              : '',
            relation: reference.relation,
          };
        }),
    })),
  };
}

export function evidenceSourceDigestV1(
  image: KnowledgeImageV5 | ArrayBufferLike | Uint8Array,
  objectId: string
): string {
  const mounted = resolveImage(image);
  const object = mounted.objects.find((candidate) => candidate.id === objectId);
  if (!object) throw new Error(`Unknown Knowledge Image object: ${objectId}.`);
  return sourceDigest(object);
}

export function evidenceSpanTextV1(
  object: Pick<KnowledgeObjectV1, 'bytes'>,
  start: number,
  end: number
): string {
  validateSpan(object.bytes, start, end);
  return new TextDecoder().decode(object.bytes.slice(start, end));
}

function resolveImage(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): KnowledgeImageV5 {
  if (isImage(input)) return mountKnowledgeImageV5(input.bytes);
  return mountKnowledgeImageV5(input);
}

function isImage(
  input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array
): input is KnowledgeImageV5 {
  return (
    typeof input === 'object' &&
    input !== null &&
    'bytes' in input &&
    'objects' in input
  );
}

function normalizeLimits(
  input: Partial<EvidenceGateLimitsV1> | undefined
): EvidenceGateLimitsV1 {
  const limits = { ...DEFAULT_EVIDENCE_GATE_LIMITS_V1, ...(input ?? {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(
        `Evidence Gate limit ${key} must be a positive safe integer.`
      );
  }
  return limits;
}

function validateRequest(
  request: EvidenceGateRequestV1,
  image: KnowledgeImageV5,
  limits: EvidenceGateLimitsV1
): void {
  if (!request.principal || typeof request.principal !== 'string')
    throw new Error('Evidence Gate principal must be non-empty.');
  if (
    !Array.isArray(request.claims) ||
    request.claims.length === 0 ||
    request.claims.length > limits.maxClaims
  )
    throw new Error(
      `Evidence Gate claims must contain between 1 and ${limits.maxClaims} entries.`
    );
  if (
    request.policy.onConflict !== 'contested' &&
    request.policy.onConflict !== 'abstain'
  )
    throw new Error('Evidence Gate onConflict must be contested or abstain.');
  if (
    !Array.isArray(request.policy.requireEvidenceFor) ||
    request.policy.requireEvidenceFor.some(
      (modality) =>
        !['fact', 'instruction', 'condition', 'calculation'].includes(modality)
    )
  )
    throw new Error(
      'Evidence Gate requireEvidenceFor contains an unsupported modality.'
    );
  if (
    request.policy.asOf !== undefined &&
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(request.policy.asOf)
  )
    throw new Error('Evidence Gate asOf must be an ISO date or date-time.');
  if (
    request.policy.minAuthority !== undefined &&
    (!Number.isFinite(request.policy.minAuthority) ||
      request.policy.minAuthority < 0)
  )
    throw new Error(
      'Evidence Gate minAuthority must be a non-negative number.'
    );
  const ids = new Set<string>();
  for (const claim of request.claims) {
    if (!claim.id || typeof claim.id !== 'string' || ids.has(claim.id))
      throw new Error(
        `Evidence Gate claim id must be unique and non-empty: ${claim.id}.`
      );
    ids.add(claim.id);
    if (!claim.text || typeof claim.text !== 'string')
      throw new Error(
        `Evidence Gate claim ${claim.id} text must be non-empty.`
      );
    if (new TextEncoder().encode(claim.text).length > limits.maxClaimTextBytes)
      throw new Error(
        `Evidence Gate claim ${claim.id} exceeds the text limit.`
      );
    if (
      !['fact', 'instruction', 'condition', 'calculation'].includes(
        claim.modality
      )
    )
      throw new Error(
        `Evidence Gate claim ${claim.id} has an unsupported modality.`
      );
    if (
      !Array.isArray(claim.evidence) ||
      claim.evidence.length > limits.maxEvidencePerClaim
    )
      throw new Error(
        `Evidence Gate claim ${claim.id} exceeds the evidence limit.`
      );
    for (const reference of claim.evidence) validateReference(reference, image);
  }
}

function validateReference(
  reference: EvidenceGateEvidenceReferenceV1,
  image: KnowledgeImageV5
): void {
  if (
    !reference ||
    typeof reference.objectId !== 'string' ||
    !reference.objectId
  )
    throw new Error('Evidence Gate evidence objectId must be non-empty.');
  if (!['supports', 'contradicts', 'qualifies'].includes(reference.relation))
    throw new Error(
      `Unsupported Evidence Gate evidence relation: ${reference.relation}.`
    );
  const object = image.objects.find(
    (candidate) => candidate.id === reference.objectId
  );
  if (!object)
    throw new Error(
      `Evidence Gate evidence references unknown object ${reference.objectId}.`
    );
  if (reference.sourceDigest !== sourceDigest(object))
    throw new Error(
      `Evidence Gate source digest mismatch for object ${reference.objectId}.`
    );
  validateSpan(object.bytes, reference.start, reference.end);
}

function validateSpan(bytes: Uint8Array, start: number, end: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > bytes.length
  )
    throw new Error(
      `Evidence Gate span must be non-empty and within 0..${bytes.length}.`
    );
}

function evaluateClaim(
  claim: EvidenceGateClaimV1,
  objectById: Map<string, KnowledgeObjectV1>,
  policy: EvidenceGatePolicyV1,
  principal: string
): EvidenceGateClaimResultV1 {
  const reasons: string[] = [];
  const evidence: string[] = [];
  let supports = 0;
  let contradicts = 0;
  let qualifies = 0;
  for (const reference of claim.evidence) {
    const object = objectById.get(reference.objectId);
    if (!object || !authorized(object, policy.knowledge, principal)) {
      reasons.push(`evidence-not-authorized:${reference.objectId}`);
      continue;
    }
    if (!applicable(object, policy)) {
      reasons.push(`evidence-not-applicable:${reference.objectId}`);
      continue;
    }
    evidence.push(evidenceKey(reference));
    if (reference.relation === 'supports') supports += 1;
    else if (reference.relation === 'contradicts') contradicts += 1;
    else qualifies += 1;
  }
  const requiresEvidence = policy.requireEvidenceFor.includes(claim.modality);
  let decision: EvidenceGateDecisionV1;
  if (contradicts > 0 && supports > 0) {
    decision = 'contested';
    reasons.push('support-and-contradiction');
  } else if (contradicts > 0) {
    decision = 'refuted';
    reasons.push('contradicting-evidence');
  } else if (supports > 0 && qualifies > 0) {
    decision = 'conditional';
    reasons.push('qualifying-evidence');
  } else if (supports > 0) {
    decision = 'supported';
  } else if (qualifies > 0) {
    decision = 'conditional';
    reasons.push('qualification-without-direct-support');
  } else {
    decision = requiresEvidence ? 'unknown' : 'conditional';
    reasons.push(
      requiresEvidence ? 'no-applicable-evidence' : 'evidence-not-required'
    );
  }
  return {
    id: claim.id,
    claimRoot: claimRoot(claim),
    decision,
    reasons: [...new Set(reasons)].sort(compareText),
    evidence: evidence.sort(compareText),
  };
}

function aggregateDecision(
  claims: EvidenceGateClaimResultV1[],
  conflictPolicy: EvidenceGateConflictPolicyV1
): EvidenceGateDecisionV1 {
  if (claims.some((claim) => claim.decision === 'refuted')) return 'refuted';
  if (claims.some((claim) => claim.decision === 'contested'))
    return conflictPolicy === 'abstain' ? 'unknown' : 'contested';
  if (claims.some((claim) => claim.decision === 'unknown')) return 'unknown';
  if (claims.some((claim) => claim.decision === 'conditional'))
    return 'conditional';
  return 'supported';
}

function authorized(
  object: KnowledgeObjectV1,
  policy: KnowledgePolicyV1,
  principal: string
): boolean {
  const matching = (policy.rules ?? []).filter(
    (rule) =>
      rule.action === 'read' &&
      (rule.principal === undefined || rule.principal === principal) &&
      (rule.kind === undefined || rule.kind.toLowerCase() === object.kind)
  );
  if (matching.some((rule) => rule.effect === 'deny')) return false;
  if (matching.some((rule) => rule.effect === 'allow')) return true;
  return policy.default === 'allow';
}

function applicable(
  object: KnowledgeObjectV1,
  policy: EvidenceGatePolicyV1
): boolean {
  const meta =
    object.meta && typeof object.meta === 'object'
      ? (object.meta as Record<string, unknown>)
      : {};
  if (policy.asOf) {
    const asOf = Date.parse(policy.asOf);
    if (!Number.isFinite(asOf)) return false;
    if (typeof meta.validFrom === 'string') {
      const validFrom = Date.parse(meta.validFrom);
      if (!Number.isFinite(validFrom) || validFrom > asOf) return false;
    }
    if (typeof meta.validUntil === 'string') {
      const validUntil = Date.parse(meta.validUntil);
      if (!Number.isFinite(validUntil) || validUntil < asOf) return false;
    }
  }
  if (policy.minAuthority !== undefined) {
    if (
      typeof meta.authority !== 'number' ||
      !Number.isFinite(meta.authority) ||
      meta.authority < policy.minAuthority
    )
      return false;
  }
  return true;
}

function sourceDigest(object: Pick<KnowledgeObjectV1, 'id' | 'bytes'>): string {
  return digestDomain(
    'evidence-source',
    canonicalCbor({ objectId: object.id, bytes: object.bytes })
  );
}

function claimRoot(claim: EvidenceGateClaimV1): string {
  return digestDomain(
    'evidence-claim',
    canonicalCbor({
      id: claim.id,
      text: claim.text,
      modality: claim.modality,
      evidence: [...claim.evidence]
        .sort((left, right) =>
          compareText(evidenceKey(left), evidenceKey(right))
        )
        .map((reference) => ({
          objectId: reference.objectId,
          sourceDigest: reference.sourceDigest,
          start: reference.start,
          end: reference.end,
          relation: reference.relation,
        })),
    } as unknown as CborValue)
  );
}

function evidenceKey(reference: EvidenceGateEvidenceReferenceV1): string {
  return `${reference.objectId}:${reference.start}:${reference.end}:${reference.relation}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
