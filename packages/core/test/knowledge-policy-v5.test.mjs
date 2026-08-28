import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeImageV5,
  evaluateKnowledgeQueryPolicyV5,
  knowledgePolicyRootV5,
  queryKnowledgeImageV5,
  verifyKnowledgeAuthorizationResultV5,
} from '../dist/index.js';

test('V5 policy evaluation is root-bound and deny-precedence', () => {
  const policy = {
    version: 1,
    default: 'deny',
    rules: [
      { effect: 'deny', action: 'query', principal: 'alice', kind: 'claims' },
      { effect: 'allow', action: 'query', principal: 'alice' },
    ],
  };
  const equivalentPolicy = { ...policy, rules: [...policy.rules].reverse() };
  assert.equal(knowledgePolicyRootV5(policy), knowledgePolicyRootV5(equivalentPolicy));
  const image = createKnowledgeImageV5({
    policy,
    objects: [
      { kind: 'chunk', bytes: new TextEncoder().encode('alpha chunk'), meta: {} },
      { kind: 'claims', bytes: new TextEncoder().encode('alpha claim'), meta: {} },
    ],
  });
  const query = queryKnowledgeImageV5(image, 'FROM * SEARCH "alpha" LIMIT 10');
  const result = evaluateKnowledgeQueryPolicyV5(image, query, equivalentPolicy, 'alice');
  assert.equal(result.decision, 'partial');
  assert.equal(result.allowedHits.length, 1);
  assert.equal(result.deniedHits.length, 1);
  verifyKnowledgeAuthorizationResultV5(image, query, equivalentPolicy, result);
  assert.equal(evaluateKnowledgeQueryPolicyV5(image, query, equivalentPolicy, 'bob').decision, 'deny');
  assert.throws(() => evaluateKnowledgeQueryPolicyV5(image, query, { version: 1, default: 'allow' }, 'alice'), /policy root/i);
});

test('V5 default-deny policy preserves existing image compatibility', () => {
  const image = createKnowledgeImageV5({ objects: [{ kind: 'metadata', bytes: new TextEncoder().encode('hello'), meta: {} }] });
  const query = queryKnowledgeImageV5(image, 'FROM metadata SEARCH "hello"');
  const result = evaluateKnowledgeQueryPolicyV5(image, query, { version: 1, default: 'deny' }, 'anonymous');
  assert.equal(result.decision, 'deny');
  assert.equal(result.allowedHits.length, 0);
  assert.equal(result.deniedHits.length, 1);
});
