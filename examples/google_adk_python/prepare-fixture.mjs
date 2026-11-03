import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeImageV5 } from '@knolo/core';

const encoder = new TextEncoder();
const destination = process.argv[2]
  ? path.resolve(process.argv[2])
  : await mkdtemp(path.join(tmpdir(), 'knolo-adk-'));
await mkdir(destination, { recursive: true });

const policy = {
  version: 1,
  default: 'deny',
  rules: [
    {
      effect: 'allow',
      action: 'query',
      principal: 'mcp:reader',
      kind: 'chunk',
    },
    {
      effect: 'allow',
      action: 'read',
      principal: 'mcp:reader',
      kind: 'chunk',
    },
  ],
};
const image = createKnowledgeImageV5({
  policy,
  objects: [
    {
      kind: 'chunk',
      bytes: encoder.encode(
        'Annual enterprise refunds are available within 30 days.'
      ),
      meta: { namespace: 'support' },
    },
    {
      kind: 'chunk',
      bytes: encoder.encode('Monthly plans are available within 14 days.'),
      meta: { namespace: 'support' },
    },
  ],
});

const imagePath = path.join(destination, 'support.v5');
const policyPath = path.join(destination, 'policy.json');
const auditDir = path.join(destination, 'audit');
const configPath = path.join(destination, 'knolo-mcp.json');
await mkdir(auditDir, { recursive: true });
await writeFile(imagePath, image.bytes);
await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

const config = {
  agentId: 'mcp',
  auditDir,
  mounts: [
    {
      id: 'support-policy',
      path: imagePath,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
      stateRoot: image.stateRoot,
      policyPath,
      agents: ['mcp'],
      principal: 'mcp:reader',
    },
  ],
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write(`${configPath}\n`);
