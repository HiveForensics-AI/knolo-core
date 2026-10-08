import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeImageV5 } from '@knolo/core';
import {
  DEFAULT_EVIDENCE_GATE_LIMITS_V1,
  evidenceSourceDigestV1,
  evidenceSpanTextV1,
  evaluateEvidenceGateV1,
  explainEvidenceGateV1,
  verifyEvidenceGateV1,
} from '../dist/index.js';

const encoder = new TextEncoder();

function fixture() {
  const policy = {
    version: 1,
    default: 'deny',
    rules: [{ effect: 'allow', action: 'read', principal: 'support-agent' }],
  };
  const image = createKnowledgeImageV5({
    policy,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('Refunds are available within 30 days.'),
        meta: { validUntil: '2027-01-01' },
      },
      {
        kind: 'chunk',
        bytes: encoder.encode('Refunds are available within 14 days.'),
        meta: { validUntil: '2027-01-01' },
      },
    ],
  });
  return { image, policy };
}

function ref(
  image,
  index,
  relation,
  start = 0,
  end = image.objects[index].bytes.length
) {
  const object = image.objects[index];
  return {
    objectId: object.id,
    sourceDigest: evidenceSourceDigestV1(image, object.id),
    start,
    end,
    relation,
  };
}

function request(
  image,
  claims,
  policy = {
    knowledge: {
      version: 1,
      default: 'deny',
      rules: [{ effect: 'allow', action: 'read', principal: 'support-agent' }],
    },
    onConflict: 'contested',
    requireEvidenceFor: ['fact', 'instruction', 'calculation'],
  }
) {
  return { image, claims, policy, principal: 'support-agent' };
}

test('supported claims produce deterministic, offline-verifiable certificates', () => {
  const { image } = fixture();
  const result = evaluateEvidenceGateV1(
    request(image, [
      {
        id: 'refund-window',
        text: 'Refunds are available within 30 days.',
        modality: 'fact',
        evidence: [ref(image, 0, 'supports')],
      },
    ])
  );
  assert.equal(result.claims[0].decision, 'supported');
  assert.equal(result.overall, 'supported');
  assert.match(result.certificateRoot, /^sha256-[0-9a-f]{64}$/);
  assert.match(result.replayHash, /^sha256-[0-9a-f]{64}$/);
  verifyEvidenceGateV1(
    result,
    request(image, [
      {
        id: 'refund-window',
        text: 'Refunds are available within 30 days.',
        modality: 'fact',
        evidence: [ref(image, 0, 'supports')],
      },
    ])
  );
});

test('conflicts are preserved and the policy controls the aggregate result', () => {
  const { image } = fixture();
  const claims = [
    {
      id: 'refund-window',
      text: 'Refunds are available within 30 days.',
      modality: 'fact',
      evidence: [ref(image, 0, 'supports'), ref(image, 1, 'contradicts')],
    },
  ];
  assert.equal(
    evaluateEvidenceGateV1(request(image, claims)).claims[0].decision,
    'contested'
  );
  assert.equal(
    evaluateEvidenceGateV1(request(image, claims)).overall,
    'contested'
  );
  const abstaining = {
    ...request(image, claims),
    policy: { ...request(image, claims).policy, onConflict: 'abstain' },
  };
  assert.equal(evaluateEvidenceGateV1(abstaining).overall, 'unknown');
});

test('missing, unauthorized, and stale evidence fail closed', () => {
  const { image } = fixture();
  const claims = [
    {
      id: 'refund-window',
      text: 'Refunds are available.',
      modality: 'fact',
      evidence: [ref(image, 0, 'supports')],
    },
  ];
  const denied = { ...request(image, claims), principal: 'unknown-agent' };
  assert.equal(evaluateEvidenceGateV1(denied).claims[0].decision, 'unknown');
  const stale = {
    ...request(image, claims),
    policy: { ...request(image, claims).policy, asOf: '2028-01-01' },
  };
  assert.equal(evaluateEvidenceGateV1(stale).claims[0].decision, 'unknown');
  const empty = request(image, [
    { id: 'missing', text: 'No evidence.', modality: 'fact', evidence: [] },
  ]);
  assert.equal(evaluateEvidenceGateV1(empty).overall, 'unknown');
});

test('authority thresholds fail closed for missing and nonnumeric metadata', () => {
  const knowledgePolicy = {
    version: 1,
    default: 'deny',
    rules: [{ effect: 'allow', action: 'read', principal: 'support-agent' }],
  };
  const image = createKnowledgeImageV5({
    policy: knowledgePolicy,
    objects: [
      {
        kind: 'chunk',
        bytes: encoder.encode('Refunds are available within 30 days.'),
        meta: { authority: 'untrusted' },
      },
    ],
  });
  const policy = {
    knowledge: knowledgePolicy,
    minAuthority: 1,
    onConflict: 'contested',
    requireEvidenceFor: ['fact'],
  };
  const result = evaluateEvidenceGateV1({
    image,
    policy,
    principal: 'support-agent',
    claims: [
      {
        id: 'refund-window',
        text: 'Refunds are available within 30 days.',
        modality: 'fact',
        evidence: [ref(image, 0, 'supports')],
      },
    ],
  });
  assert.equal(result.claims[0].decision, 'unknown');
  assert.deepEqual(result.claims[0].reasons, [
    `evidence-not-applicable:${image.objects[0].id}`,
    'no-applicable-evidence',
  ]);
});

test('zero-length evidence spans are rejected', () => {
  const { image } = fixture();
  assert.throws(
    () =>
      evaluateEvidenceGateV1(
        request(image, [
          {
            id: 'empty-span',
            text: 'Refunds',
            modality: 'fact',
            evidence: [ref(image, 0, 'supports', 0, 0)],
          },
        ])
      ),
    /non-empty/
  );
  assert.throws(() => evidenceSpanTextV1(image.objects[0], 0, 0), /non-empty/);
});

test('tampering with evidence or the result is rejected', () => {
  const { image } = fixture();
  const claims = [
    {
      id: 'refund-window',
      text: 'Refunds are available.',
      modality: 'fact',
      evidence: [ref(image, 0, 'supports')],
    },
  ];
  const req = request(image, claims);
  const result = evaluateEvidenceGateV1(req);
  const tampered = structuredClone(result);
  tampered.claims[0].decision = 'refuted';
  assert.throws(
    () => verifyEvidenceGateV1(tampered, req),
    /certificate|replay/i
  );
  const changedClaim = structuredClone(req);
  changedClaim.claims[0].text = 'Refunds are never available.';
  assert.throws(
    () => verifyEvidenceGateV1(result, changedClaim),
    /certificate|replay/i
  );
  const bad = structuredClone(req);
  bad.claims[0].evidence[0].end -= 1;
  assert.throws(() => verifyEvidenceGateV1(result, bad), /certificate|replay/i);
});

test('certificate verification ignores JSON object key order', () => {
  const { image } = fixture();
  const req = request(image, [
    {
      id: 'refund-window',
      text: 'Refunds are available within 30 days.',
      modality: 'fact',
      evidence: [ref(image, 0, 'supports')],
    },
  ]);
  const result = evaluateEvidenceGateV1(req);
  const reordered = {
    replayHash: result.replayHash,
    certificateRoot: result.certificateRoot,
    overall: result.overall,
    claims: result.claims,
    limits: result.limits,
    principal: result.principal,
    evaluationRoot: result.evaluationRoot,
    policyRoot: result.policyRoot,
    stateRoot: result.stateRoot,
    version: result.version,
  };
  verifyEvidenceGateV1(reordered, req);
});

test('explanation returns verified source text and byte spans', () => {
  const { image } = fixture();
  const evidence = ref(image, 0, 'supports', 0, 7);
  const req = request(image, [
    {
      id: 'refund-window',
      text: 'Refunds',
      modality: 'fact',
      evidence: [evidence],
    },
  ]);
  const result = evaluateEvidenceGateV1(req);
  const explanation = explainEvidenceGateV1(result, req);
  assert.equal(explanation.claims[0].evidence[0].text, 'Refunds');
  assert.equal(evidenceSpanTextV1(image.objects[0], 0, 7), 'Refunds');
  assert.equal(DEFAULT_EVIDENCE_GATE_LIMITS_V1.maxClaims, 1000);
});
