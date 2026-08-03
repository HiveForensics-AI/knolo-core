#!/usr/bin/env node
/**
 * Generate local-only dummy knowledge docs and build a .knolo pack for ICP seeding.
 * Output lives under tests/icp-local/data/ (gitignored).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const dataDir = path.join(scriptDir, 'data');
const knowledgeDir = path.join(dataDir, 'knowledge');
const packPath = path.join(dataDir, 'seed.knolo');
const cliPath = path.join(repoRoot, 'packages/cli/bin/knolo.mjs');

const DUMMY_DOCS = [
  {
    rel: 'alpha-onboarding.md',
    body: `# Alpha Onboarding

Welcome to the Knolo ICP dummy corpus used only for local testing.

Search terms: alpha onboarding canister lexical retrieval postman gateway.

Operators upload this pack with set_pack, then query via knolo CLI or the local REST gateway.
`,
  },
  {
    rel: 'guides/billing-escalation.md',
    body: `# Billing Escalation Guide

Dummy billing escalation playbook for local ICP search tests.

Keywords: billing escalation invoice refund sla priority ticket queue.

When a customer reports a billing issue, capture the invoice id and refund eligibility notes.
`,
  },
  {
    rel: 'guides/deploy-checklist.md',
    body: `# Deploy Checklist

Local dummy deploy checklist for Internet Computer knowledge canisters.

Steps: dfx start, dfx deploy, build pack, upload seed, run health, run search, verify pack_info.

This document is synthetic seed data and must never ship to production networks.
`,
  },
  {
    rel: 'support/password-reset.md',
    body: `# Password Reset Support

Dummy password reset article for multi-hit ranking checks.

Terms: password reset email otp session token support article.

Advise users to request a one-time passcode and verify the account email before rotating credentials.
`,
  },
];

function log(msg) {
  console.log(`[generate-seed] ${msg}`);
}

if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
}

mkdirSync(path.join(knowledgeDir, 'guides'), { recursive: true });
mkdirSync(path.join(knowledgeDir, 'support'), { recursive: true });

for (const doc of DUMMY_DOCS) {
  const full = path.join(knowledgeDir, doc.rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, doc.body, 'utf8');
  log(`wrote ${path.relative(scriptDir, full)}`);
}

if (!existsSync(cliPath)) {
  console.error(`knolo CLI not found at ${cliPath}`);
  process.exit(1);
}

log('Building @knolo/core');
execFileSync('npm', ['run', 'build', '--workspace', '@knolo/core'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

log(`Building pack -> ${path.relative(repoRoot, packPath)}`);
execFileSync(
  process.execPath,
  [cliPath, 'icp', 'build-pack', knowledgeDir, '--out', packPath],
  { cwd: repoRoot, stdio: 'inherit' }
);

if (!existsSync(packPath)) {
  console.error(`Expected pack at ${packPath}`);
  process.exit(1);
}

writeFileSync(
  path.join(dataDir, 'manifest.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      docs: DUMMY_DOCS.map((d) => d.rel),
      pack: 'seed.knolo',
      label: 'local-dummy-seed',
      note: 'Generated local test data. Do not commit.',
    },
    null,
    2
  ),
  'utf8'
);

log('OK');
log(`Pack: ${packPath}`);
log(`Docs: ${DUMMY_DOCS.length} files under ${knowledgeDir}`);
