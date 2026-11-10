import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

let networkCalls = 0;
function rejectNetwork() {
  networkCalls += 1;
  throw new Error('network disabled');
}
globalThis.fetch = rejectNetwork;
http.request = rejectNetwork;
http.get = rejectNetwork;
https.request = rejectNetwork;
https.get = rejectNetwork;

const box = await import('../dist/index.js');
const { main } = await import('../dist/cli.js');
const { KnoloOpenClawService, KnoloPluginError } = await import('@knolo/tools');
const core = await import('@knolo/core');
const cortex = await import('@knolo/core/cortex');

const {
  BoxError,
  SESSION_COUNT_CAP,
  boxStatus,
  buildBox,
  chatFileTooLarge,
  defaultBoxConfig,
  initBox,
  loadBoxConfig,
  mcpBinPath,
  selectNewestSessions,
  turnTooLarge,
} = box;
const { mountKnowledgeImageV5 } = core;
const { askCortex, createCortexSession, verifyCortexAnswer } = cortex;
const { createKnowledgeImageV5 } = core;

const binPath = fileURLToPath(new URL('../bin/knolo-box.mjs', import.meta.url));
const CHAT_CAP = 8 * 1024 * 1024;
const FILE_CAP = 256 * 1024;
const TURN_SIZE = 7000;

function sized(marker, total) {
  assert.ok(marker.length < total);
  return marker + 'x'.repeat(total - marker.length);
}

async function tempHome() {
  return mkdtemp(path.join(os.tmpdir(), 'knolo-box-'));
}

async function indexedText(output) {
  const names = (await readdir(output)).filter((name) => name.endsWith('.v5'));
  const parts = [];
  for (const name of names) {
    const bytes = await readFile(path.join(output, name));
    const image = mountKnowledgeImageV5(bytes);
    for (const object of image.objects) {
      parts.push(Buffer.from(object.bytes).toString('utf8'));
    }
  }
  return parts.join('\n');
}

async function openService(output) {
  const raw = JSON.parse(
    await readFile(path.join(output, 'knolo-mcp.json'), 'utf8')
  );
  const {
    agentId: _agentId,
    sessionId: _sessionId,
    autoRebuild: _autoRebuild,
    ...plugin
  } = raw;
  return KnoloOpenClawService.create(plugin);
}

async function writeComputer(home) {
  const grok = path.join(home, 'grok');
  const output = path.join(home, 'out');
  const notes = path.join(grok, 'notes');
  const skillDir = path.join(grok, 'skills', 'release-notes');
  const topicDir = path.join(
    grok,
    'memory-v2',
    'workspaces',
    'example',
    'topics'
  );
  const inbox = path.join(
    grok,
    'memory-v2',
    'workspaces',
    'example',
    'observations',
    '_inbox'
  );
  const session = path.join(grok, 'sessions', 'demo');
  const huge = path.join(grok, 'sessions', 'huge');
  const capped = path.join(grok, 'sessions', 'capped');
  const turns = path.join(grok, 'sessions', 'turns');
  await Promise.all(
    [notes, skillDir, topicDir, inbox, session, huge, capped, turns].map(
      (dir) => mkdir(dir, { recursive: true })
    )
  );
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    '# Release skill\n\nBOX_SKILL_PHRASE release checklist lives here.\n'
  );
  await writeFile(path.join(skillDir, 'README.md'), 'SKILL_README_SECRET\n');
  await writeFile(
    path.join(topicDir, 'release.md'),
    '# Release\n\nBOX_MEMORY_PHRASE quarterly close is draft.\n'
  );
  await writeFile(
    path.join(inbox, 'seen.md'),
    'BOX_OBSERVATION_PHRASE seen once.\n'
  );
  await writeFile(
    path.join(grok, 'memory-v2', 'workspaces', 'example', 'MEMORY.md'),
    'UNIQUE_MEMORY_INDEX\n'
  );
  await writeFile(
    path.join(grok, 'memory-v2', 'readme.md'),
    'MEMORY_OTHER_SECRET\n'
  );
  await mkdir(path.join(grok, 'memory-v2', 'global'), { recursive: true });
  await writeFile(
    path.join(grok, 'memory-v2', 'global', 'state.sqlite'),
    'UNIQUE_SQLITE_SECRET'
  );
  await writeFile(
    path.join(notes, 'hours.md'),
    'BOX_FILE_PHRASE warehouse hours.\n'
  );
  await writeFile(
    path.join(notes, 'plain.txt'),
    'BOX_TXT_PHRASE plain note.\n'
  );
  await writeFile(path.join(notes, 'code.js'), 'JS_SECRET\n');
  await writeFile(
    path.join(notes, 'huge.md'),
    Buffer.concat([
      Buffer.from('FILE_TOO_LARGE_SECRET\n'),
      Buffer.alloc(FILE_CAP, 0x62),
    ])
  );
  await mkdir(path.join(notes, 'node_modules'), { recursive: true });
  await writeFile(
    path.join(notes, 'node_modules', 'secret.md'),
    'NODE_MODULES_SECRET\n'
  );
  await writeFile(
    path.join(notes, '.env'),
    'UNIQUE_ENV_SECRET\n-----BEGIN PRIVATE KEY-----\n'
  );
  await writeFile(path.join(notes, '.env.local'), 'ENV_LOCAL_SECRET\n');
  await writeFile(
    path.join(notes, 'auth.json'),
    '{"token":"UNIQUE_AUTH_SECRET"}\n'
  );
  await writeFile(path.join(notes, 'config.toml'), 'UNIQUE_CONFIG_SECRET\n');
  await writeFile(path.join(session, 'secrets.pem'), 'UNIQUE_PEM_SECRET\n');
  await writeFile(path.join(session, 'id_rsa'), 'UNIQUE_KEY_SECRET\n');
  await writeFile(
    path.join(session, 'system_prompt.txt'),
    'SYSTEM_PROMPT_SECRET\n'
  );
  await writeFile(
    path.join(session, 'tool_definitions.json'),
    'TOOL_DEFINITIONS_SECRET\n'
  );
  await writeFile(path.join(session, 'updates.jsonl'), 'UPDATES_SECRET\n');
  await writeFile(
    path.join(session, 'summary.json'),
    `${JSON.stringify(
      {
        agent_name: 'release',
        generated_title: 'Quarterly notes',
        session_summary: 'BOX_SUMMARY_PHRASE valve log review',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-04T00:00:00Z',
        info: { cwd: '/work/example' },
      },
      null,
      2
    )}\n`
  );
  const chat = [
    { type: 'system', content: 'SYSTEM_SECRET do not index' },
    { type: 'user', content: 'BOX_USER_PHRASE posting rules are draft only' },
    { type: 'reasoning', content: 'REASONING_SECRET hidden' },
    {
      type: 'assistant',
      content: JSON.stringify([
        { type: 'text', text: 'BOX_ASSISTANT_PHRASE noted' },
        { type: 'tool_use', name: 'shell', input: 'TOOL_USE_SECRET' },
      ]),
    },
    { type: 'tool_result', content: 'TOOL_RESULT_SECRET raw tool output' },
    { type: 'backend_tool_call', content: 'BACKEND_SECRET' },
  ];
  await writeFile(
    path.join(session, 'chat_history.jsonl'),
    `${chat.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
  await writeFile(
    path.join(huge, 'summary.json'),
    `${JSON.stringify({
      agent_name: 'release',
      generated_title: 'Large log',
      session_summary: 'BOX_BIG_SUMMARY kept',
      updated_at: '2026-11-04T01:00:00Z',
    })}\n`
  );
  await writeFile(
    path.join(huge, 'chat_history.jsonl'),
    Buffer.concat([Buffer.from('BOX_BIG_CHAT\n'), Buffer.alloc(CHAT_CAP, 0x20)])
  );
  await writeFile(
    path.join(capped, 'summary.json'),
    `${JSON.stringify({
      agent_name: 'release',
      session_summary: 'cap session',
      updated_at: '2026-11-04T02:00:00Z',
    })}\n`
  );
  const capLines = [];
  for (let index = 0; index < 9; index += 1) {
    const marker = index === 0 ? 'SESSION_CAP_HEAD' : `pad-${index}`;
    capLines.push({ type: 'user', content: sized(marker, TURN_SIZE) });
  }
  capLines.push({
    type: 'user',
    content: sized('SESSION_CAP_TAIL', TURN_SIZE),
  });
  await writeFile(
    path.join(capped, 'chat_history.jsonl'),
    `${capLines.map((row) => JSON.stringify(row)).join('\n')}\n`
  );
  await writeFile(
    path.join(turns, 'summary.json'),
    `${JSON.stringify({
      agent_name: 'release',
      session_summary: 'turn cap',
      updated_at: '2026-11-04T03:00:00Z',
    })}\n`
  );
  await writeFile(
    path.join(turns, 'chat_history.jsonl'),
    `${[
      { type: 'user', content: `TURN_TOO_BIG_${'A'.repeat(9000)}` },
      {
        type: 'user',
        content: 'TURN_KEPT_PHRASE posting rules are draft only',
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n')}\n`
  );
  const configPath = path.join(home, 'box.json');
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        output: '~/out',
        grokHome: '$GROK_HOME',
        agents: ['box', 'publisher', 'box'],
        scopes: {
          files: { roots: ['${GROK_HOME}/notes'] },
          skills: { roots: ['~/grok/skills'] },
          memory: { roots: ['$GROK_HOME/memory-v2'] },
          transcripts: { roots: ['$GROK_HOME/sessions'] },
        },
      },
      null,
      2
    )}\n`
  );
  const config = await loadBoxConfig(configPath, { GROK_HOME: grok }, home);
  return { config, configPath, grok, output };
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out: ${args.join(' ')}`));
    }, 15000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('indexes Grok files and keeps secrets out of every image', async () => {
  const home = await tempHome();
  try {
    const { config, output } = await writeComputer(home);
    assert.equal(config.output, output);
    assert.deepEqual(config.agents, ['box', 'publisher']);
    const firstAt = new Date('2026-11-04T03:00:00.000Z');
    const pins = await buildBox(config, firstAt);
    const text = await indexedText(output);
    for (const secret of [
      'UNIQUE_ENV_SECRET',
      'ENV_LOCAL_SECRET',
      'UNIQUE_AUTH_SECRET',
      'UNIQUE_SQLITE_SECRET',
      'UNIQUE_MEMORY_INDEX',
      'UNIQUE_CONFIG_SECRET',
      'UNIQUE_PEM_SECRET',
      'UNIQUE_KEY_SECRET',
      'SYSTEM_PROMPT_SECRET',
      'TOOL_DEFINITIONS_SECRET',
      'UPDATES_SECRET',
      'SYSTEM_SECRET',
      'REASONING_SECRET',
      'TOOL_USE_SECRET',
      'TOOL_RESULT_SECRET',
      'BACKEND_SECRET',
      'SKILL_README_SECRET',
      'MEMORY_OTHER_SECRET',
      'JS_SECRET',
      'NODE_MODULES_SECRET',
      'FILE_TOO_LARGE_SECRET',
      'BOX_BIG_CHAT',
      'TURN_TOO_BIG_',
      'SESSION_CAP_TAIL',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      assert.equal(text.includes(secret), false, secret);
    }
    for (const kept of [
      'BOX_SKILL_PHRASE',
      'BOX_MEMORY_PHRASE',
      'BOX_OBSERVATION_PHRASE',
      'BOX_FILE_PHRASE',
      'BOX_TXT_PHRASE',
      'BOX_SUMMARY_PHRASE',
      'BOX_USER_PHRASE',
      'BOX_ASSISTANT_PHRASE',
      'BOX_BIG_SUMMARY',
      'SESSION_CAP_HEAD',
      'TURN_KEPT_PHRASE',
      'source: memory-v2/workspaces/example/topics/release.md',
      'source: skills/release-notes/SKILL.md',
      'source: sessions/demo/chat_history.jsonl',
      'locator: turn 1',
      'when: 2026-11-04T00:00:00Z',
      'agent: release',
      'cwd: /work/example',
    ]) {
      assert.equal(text.includes(kept), true, kept);
    }
    assert.equal(
      pins.skipped.some(
        (item) => item.reason === 'too-large' && item.path === 'notes/huge.md'
      ),
      true
    );
    assert.equal(
      pins.skipped.some(
        (item) =>
          item.reason === 'too-large' &&
          item.path === 'sessions/huge/chat_history.jsonl'
      ),
      true
    );

    const raw = JSON.parse(
      await readFile(path.join(output, 'knolo-mcp.json'), 'utf8')
    );
    assert.equal(raw.agentId, 'box');
    assert.equal(raw.maxAuditRecords, 10000);
    assert.equal(raw.maxAuditBytes, 256 * 1024 * 1024);
    assert.equal(raw.auditDir, path.join(output, 'audit'));
    assert.deepEqual(
      raw.mounts.map((mount) => mount.id),
      ['files', 'skills', 'memory', 'transcripts']
    );
    assert.deepEqual(raw.mounts.find((mount) => mount.id === 'memory').agents, [
      'box',
    ]);
    assert.deepEqual(
      raw.mounts.find((mount) => mount.id === 'transcripts').agents,
      ['box']
    );
    assert.deepEqual(raw.mounts.find((mount) => mount.id === 'skills').agents, [
      'box',
      'publisher',
    ]);
    assert.equal(raw.grokHome, config.grokHome);
    for (const mount of raw.mounts) {
      assert.equal(path.isAbsolute(mount.path), true);
      assert.equal(mount.principal, 'box:reader');
      assert.equal(mount.builtAt, '2026-11-04T03:00:00.000Z');
      assert.match(mount.sourceDigest, /^[a-f0-9]{64}$/);
      assert.equal(mount.sourceRoots.length > 0, true);
      for (const root of mount.sourceRoots) {
        assert.equal(path.isAbsolute(root), true);
      }
    }
    const shared = JSON.parse(
      await readFile(path.join(output, 'knolo-mcp-shared.json'), 'utf8')
    );
    assert.deepEqual(
      shared.mounts.map((mount) => mount.id),
      ['files', 'skills']
    );
    assert.equal(shared.grokHome, config.grokHome);
    assert.equal(
      shared.mounts.some((mount) => mount.id === 'memory'),
      false
    );

    const caller = { agentId: 'box', sessionId: 'knolo-box-test' };
    const service = await openService(output);
    const found = await service.search(
      { query: 'BOX_MEMORY_PHRASE', imageIds: ['memory'], limit: 4 },
      caller
    );
    assert.equal(found.receipts.length, 1);
    assert.equal(found.hits.length, 1);
    assert.equal(found.hits[0].receiptId, found.receipts[0].receiptId);
    assert.match(
      found.hits[0].excerpt,
      /source: memory-v2\/workspaces\/example\/topics\/release.md/
    );
    assert.match(found.hits[0].excerpt, /locator: lines \d+-\d+/);
    assert.equal(found.hits[0].excerpt.includes('when:'), false);
    await service.verifyReceipt(found.receipts[0].receiptId);
    const receipt = JSON.parse(
      await readFile(
        path.join(output, 'audit', `${found.receipts[0].receiptId}.json`),
        'utf8'
      )
    );
    assert.equal(receipt.version, 'openclaw-knolo-query-v1');
    const full = await service.get(
      {
        imageId: found.hits[0].imageId,
        objectId: found.hits[0].objectId,
        stateRoot: found.hits[0].stateRoot,
      },
      caller
    );
    assert.match(full.content, /BOX_MEMORY_PHRASE/);
    const skill = await service.search(
      { query: 'BOX_SKILL_PHRASE', imageIds: ['skills'], limit: 4 },
      caller
    );
    assert.equal(skill.receipts.length, 1);
    assert.match(
      skill.hits[0].excerpt,
      /source: skills\/release-notes\/SKILL.md/
    );
    assert.match(skill.hits[0].excerpt, /locator: lines /);
    const verified = await service.verify('memory', caller);
    assert.equal(verified[0].valid, true);
    assert.equal(verified[0].stale, false);
    assert.equal(verified[0].builtAt, '2026-11-04T03:00:00.000Z');
    const status = service.status(caller);
    assert.equal(Object.hasOwn(status[0], 'builtAt'), false);
    assert.equal(Object.hasOwn(status[0], 'stale'), false);
    const freshStatus = await service.statusWithFreshness(caller);
    assert.equal(
      freshStatus.find((item) => item.imageId === 'memory').stale,
      false
    );
    assert.equal(
      freshStatus.find((item) => item.imageId === 'memory').builtAt,
      '2026-11-04T03:00:00.000Z'
    );
    const printed = await boxStatus(config);
    assert.equal(printed.find((item) => item.id === 'memory').pinMatches, true);
    assert.equal(printed.find((item) => item.id === 'memory').stale, false);
    assert.equal(
      printed.find((item) => item.id === 'memory').builtAt,
      '2026-11-04T03:00:00.000Z'
    );

    await assert.rejects(
      () =>
        service.search(
          { query: 'BOX_MEMORY_PHRASE', imageIds: ['memory'] },
          { agentId: 'publisher' }
        ),
      (error) => {
        assert.equal(error instanceof KnoloPluginError, true);
        assert.equal(error.code, 'ACCESS_DENIED');
        assert.equal(error.message.includes('BOX_MEMORY_PHRASE'), false);
        return true;
      }
    );
    await assert.rejects(
      () =>
        service.search(
          { query: 'BOX_USER_PHRASE', imageIds: ['transcripts'] },
          { agentId: 'publisher' }
        ),
      (error) => {
        assert.equal(error.code, 'ACCESS_DENIED');
        return true;
      }
    );
    const sharedHit = await service.search(
      { query: 'BOX_FILE_PHRASE', imageIds: ['files'] },
      { agentId: 'publisher' }
    );
    assert.match(sharedHit.hits[0].excerpt, /BOX_FILE_PHRASE/);

    const again = await buildBox(config, new Date('2026-11-05T03:00:00.000Z'));
    assert.equal(again.scopes.memory.stateRoot, pins.scopes.memory.stateRoot);
    assert.equal(again.scopes.memory.builtAt, pins.scopes.memory.builtAt);
    assert.equal(again.scopes.skills.builtAt, pins.scopes.skills.builtAt);
    const memoryPath = path.join(output, 'memory.v5');
    const beforeRewrite = await readFile(memoryPath);
    await rm(memoryPath);
    const rewritten = await buildBox(
      config,
      new Date('2026-11-05T04:00:00.000Z')
    );
    assert.equal(
      rewritten.scopes.memory.stateRoot,
      pins.scopes.memory.stateRoot
    );
    assert.equal(rewritten.scopes.memory.builtAt, '2026-11-05T04:00:00.000Z');
    assert.deepEqual(await readFile(memoryPath), beforeRewrite);

    const topic = path.join(
      home,
      'grok',
      'memory-v2',
      'workspaces',
      'example',
      'topics',
      'release.md'
    );
    await writeFile(
      topic,
      '# Release\n\nBOX_MEMORY_PHRASE edited after the first build.\n'
    );
    const drifted = await boxStatus(config);
    assert.equal(drifted.find((item) => item.id === 'memory').stale, true);
    assert.equal(drifted.find((item) => item.id === 'memory').pinMatches, true);
    assert.equal(
      drifted.find((item) => item.id === 'memory').builtAt,
      rewritten.scopes.memory.builtAt
    );
    assert.equal(drifted.find((item) => item.id === 'skills').stale, false);
    const current = await openService(output);
    const driftedTool = await current.statusWithFreshness(caller);
    assert.equal(
      driftedTool.find((item) => item.imageId === 'memory').stale,
      true
    );
    assert.equal(
      driftedTool.find((item) => item.imageId === 'memory').builtAt,
      rewritten.scopes.memory.builtAt
    );
    const driftedVerify = await current.verify('memory', caller);
    assert.equal(driftedVerify[0].valid, true);
    assert.equal(driftedVerify[0].stale, true);
    assert.equal(driftedVerify[0].builtAt, rewritten.scopes.memory.builtAt);
    const edited = await buildBox(config, new Date('2026-11-06T03:00:00.000Z'));
    assert.notEqual(
      edited.scopes.memory.stateRoot,
      pins.scopes.memory.stateRoot
    );
    assert.equal(edited.scopes.memory.builtAt, '2026-11-06T03:00:00.000Z');
    assert.equal(edited.scopes.skills.stateRoot, pins.scopes.skills.stateRoot);
    assert.equal(edited.scopes.skills.builtAt, pins.scopes.skills.builtAt);
    const rebuilt = await boxStatus(config);
    assert.equal(rebuilt.find((item) => item.id === 'memory').stale, false);
    assert.equal(rebuilt.find((item) => item.id === 'memory').pinMatches, true);
    assert.equal(
      rebuilt.find((item) => item.id === 'memory').builtAt,
      '2026-11-06T03:00:00.000Z'
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a private-key or token match writes no new image', async () => {
  const secrets = [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '-----BEGIN EC PRIVATE KEY-----',
    '-----BEGIN DSA PRIVATE KEY-----',
    '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    `ghp_${'a'.repeat(20)}`,
    'github_pat_example_token_value',
  ];
  for (const secretLine of secrets) {
    const home = await tempHome();
    try {
      const grok = path.join(home, 'grok');
      const topicDir = path.join(grok, 'memory-v2', 'topics');
      await mkdir(topicDir, { recursive: true });
      const topic = path.join(topicDir, 'note.md');
      await writeFile(topic, 'clean box note\n');
      const config = {
        output: path.join(home, 'out'),
        grokHome: grok,
        agents: ['box'],
        scopes: {
          files: { roots: [] },
          skills: { roots: [] },
          memory: { roots: [path.join(grok, 'memory-v2')] },
          transcripts: { roots: [] },
        },
      };
      const pins = await buildBox(config, new Date('2026-11-04T00:00:00.000Z'));
      const imagePath = path.join(config.output, 'memory.v5');
      const before = await readFile(imagePath);
      await writeFile(topic, `${secretLine}\nclean box note\n`);
      await assert.rejects(
        () => buildBox(config, new Date('2026-11-06T00:00:00.000Z')),
        (error) => {
          assert.equal(error instanceof BoxError, true);
          assert.equal(error.code, 'BOX_SECRET');
          assert.match(error.message, /No new image was written/);
          assert.equal(error.message.includes(secretLine), false);
          return true;
        }
      );
      assert.deepEqual(await readFile(imagePath), before);
      const pinsAfter = JSON.parse(
        await readFile(path.join(config.output, 'pins.json'), 'utf8')
      );
      assert.equal(pinsAfter.scopes.memory.builtAt, pins.scopes.memory.builtAt);
      assert.equal(
        pinsAfter.scopes.memory.stateRoot,
        pins.scopes.memory.stateRoot
      );
      assert.equal(pinsAfter.scopes.memory.sha256, pins.scopes.memory.sha256);
      const secretStatus = await boxStatus(config);
      assert.equal(secretStatus[0].stale, true);
      assert.equal(secretStatus[0].pinMatches, true);
      assert.equal(secretStatus[0].builtAt, pins.scopes.memory.builtAt);
      assert.equal(JSON.stringify(secretStatus).includes(secretLine), false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});

test('a flipped image byte fails the pin and returns no chunk text', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const topicDir = path.join(grok, 'memory-v2', 'topics');
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, 'note.md'),
      'BOX_FLIP_PHRASE stays sealed.\n'
    );
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config, new Date('2026-11-04T00:00:00.000Z'));
    const imagePath = path.join(config.output, 'memory.v5');
    const bytes = await readFile(imagePath);
    bytes[Math.min(32, bytes.length - 1)] ^= 0xff;
    await writeFile(imagePath, bytes);
    const status = await boxStatus(config);
    assert.equal(status[0].pinMatches, false);
    assert.equal(status[0].stale, false);
    await assert.rejects(
      () => openService(config.output),
      (error) => {
        assert.equal(error instanceof KnoloPluginError, true);
        assert.equal(error.code, 'IMAGE_INVALID');
        assert.equal(error.message.includes('BOX_FLIP_PHRASE'), false);
        return true;
      }
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a missing source root is stale while the pin still matches', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const topicDir = path.join(grok, 'memory-v2', 'topics');
    await mkdir(topicDir, { recursive: true });
    await writeFile(path.join(topicDir, 'note.md'), 'BOX_ROOT_PHRASE\n');
    const root = path.join(grok, 'memory-v2');
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [] },
        memory: { roots: [root] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config, new Date('2026-11-04T00:00:00.000Z'));
    await rm(root, { recursive: true, force: true });
    const status = await boxStatus(config);
    assert.equal(status[0].id, 'memory');
    assert.equal(status[0].pinMatches, true);
    assert.equal(status[0].stale, true);
    assert.equal(status[0].builtAt, '2026-11-04T00:00:00.000Z');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('an empty computer does not walk the home directory', async () => {
  const home = await tempHome();
  try {
    const config = defaultBoxConfig(
      { GROK_HOME: path.join(home, 'grok') },
      home
    );
    assert.deepEqual(config.scopes.files.roots, []);
    await mkdir(config.output, { recursive: true });
    await writeFile(
      path.join(config.output, 'knolo-mcp.json'),
      '{"mounts":[{"id":"old"}]}\n'
    );
    await writeFile(
      path.join(config.output, 'knolo-mcp-shared.json'),
      '{"mounts":[{"id":"old"}]}\n'
    );
    const pins = await buildBox(config, new Date('2026-11-04T00:00:00.000Z'));
    assert.deepEqual(pins.scopes, {});
    assert.equal(
      pins.skipped.every((item) => item.path.startsWith(home)),
      true
    );
    const names = await readdir(config.output);
    assert.equal(names.includes('knolo-mcp.json'), false);
    assert.equal(names.includes('knolo-mcp-shared.json'), false);
    assert.equal(
      names.some((name) => name.endsWith('.v5')),
      false
    );
    const configPath = path.join(home, 'box.json');
    await writeFile(
      configPath,
      `${JSON.stringify({
        output: config.output,
        grokHome: config.grokHome,
        scopes: {
          files: { roots: [] },
          skills: { roots: [] },
          memory: { roots: [] },
          transcripts: { roots: [] },
        },
      })}\n`
    );
    assert.equal(await main(['mcp', '--config', configPath]), 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a symlink into a denied directory is not indexed', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const notes = path.join(grok, 'notes');
    const logs = path.join(notes, 'logs');
    await mkdir(logs, { recursive: true });
    await writeFile(path.join(logs, 'secret.md'), 'SYMLINK_LOG_SECRET\n');
    await symlink('logs', path.join(notes, 'archive'));
    await symlink(path.join(logs, 'secret.md'), path.join(notes, 'alias.md'));
    await writeFile(path.join(notes, 'ok.md'), 'SYMLINK_OK_PHRASE\n');
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [notes] },
        skills: { roots: [] },
        memory: { roots: [] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config);
    const text = await indexedText(config.output);
    assert.equal(text.includes('SYMLINK_LOG_SECRET'), false);
    assert.equal(text.includes('SYMLINK_OK_PHRASE'), true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a later build removes a shared config with no mounts', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const skillDir = path.join(grok, 'skills', 'release-notes');
    await mkdir(path.join(grok, 'memory-v2', 'topics'), { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'BOX_SKILL_STAYS\n');
    await writeFile(
      path.join(grok, 'memory-v2', 'topics', 'only.md'),
      'BOX_PRIVATE_STAYS\n'
    );
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box', 'publisher'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [path.join(grok, 'skills')] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config);
    assert.equal(
      (await readdir(config.output)).includes('knolo-mcp-shared.json'),
      true
    );
    config.scopes.skills.roots = [];
    await buildBox(config);
    const names = await readdir(config.output);
    assert.equal(names.includes('knolo-mcp-shared.json'), false);
    assert.equal(names.includes('skills.v5'), true);
    const raw = JSON.parse(
      await readFile(path.join(config.output, 'knolo-mcp.json'), 'utf8')
    );
    assert.deepEqual(
      raw.mounts.map((mount) => mount.id),
      ['memory']
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('private-only images omit the shared config', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    await mkdir(path.join(grok, 'memory-v2', 'topics'), { recursive: true });
    await writeFile(
      path.join(grok, 'memory-v2', 'topics', 'only.md'),
      'BOX_PRIVATE_ONLY\n'
    );
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config);
    const names = await readdir(config.output);
    assert.equal(names.includes('memory.v5'), true);
    assert.equal(names.includes('knolo-mcp-shared.json'), false);
    const raw = JSON.parse(
      await readFile(path.join(config.output, 'knolo-mcp.json'), 'utf8')
    );
    assert.deepEqual(
      raw.mounts.map((mount) => mount.id),
      ['memory']
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('session and turn caps stay inside the exported limits', () => {
  assert.equal(SESSION_COUNT_CAP, 2000);
  assert.equal(turnTooLarge('a'.repeat(8192)), false);
  assert.equal(turnTooLarge('a'.repeat(8193)), true);
  assert.equal(chatFileTooLarge(CHAT_CAP), false);
  assert.equal(chatFileTooLarge(CHAT_CAP + 1), true);
  const sessions = Array.from({ length: 2001 }, (_, index) => ({
    updatedAt: String(index).padStart(5, '0'),
    path: `s${index}`,
  }));
  const selected = selectNewestSessions(sessions);
  assert.equal(selected.length, 2000);
  assert.equal(selected[0].path, 's2000');
  assert.equal(
    selected.some((item) => item.path === 's0'),
    false
  );
  const tied = selectNewestSessions(
    [
      { updatedAt: '2026-11-04', path: 'b' },
      { updatedAt: '2026-11-04', path: 'a' },
      { updatedAt: '2026-11-03', path: 'c' },
    ],
    2
  );
  assert.deepEqual(
    tied.map((item) => item.path),
    ['a', 'b']
  );
});

test('cortex verify accepts a valve trace and fails closed on a changed gap or byte', async () => {
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
    actor: 'cortex-conformance',
    sequence: 1,
    policy,
    objects: [
      {
        kind: 'chunk',
        bytes: Buffer.from('The valve inspection passed.'),
        meta: { source: 'a.txt' },
      },
      {
        kind: 'chunk',
        bytes: Buffer.from('The pump was replaced.'),
        meta: { source: 'b.txt' },
      },
    ],
  });
  const session = await createCortexSession({ image: image.bytes });
  const found = await askCortex(session, {
    question: 'valve',
    mode: 'find_relevant',
  });
  const verified = await verifyCortexAnswer({
    image: image.bytes,
    question: 'valve',
    result: found,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.traceRoot, found.receipt.traceRoot);
  const tampered = structuredClone(found);
  tampered.answer.gaps.push({
    subquestion: found.question,
    reason: 'tampered',
  });
  const gap = await verifyCortexAnswer({
    image: image.bytes,
    question: 'valve',
    result: tampered,
  });
  assert.equal(gap.ok, false);
  const flipped = Uint8Array.from(image.bytes);
  flipped[flipped.length - 1] ^= 0xff;
  const changed = await verifyCortexAnswer({
    image: flipped,
    question: 'valve',
    result: found,
  });
  assert.equal(changed.ok, false);
});

test('the launcher finds knolo-mcp and the CLI stays off stdout for help', async () => {
  assert.equal((await stat(binPath)).mode & 0o111, 0o111);
  const mcp = mcpBinPath();
  assert.equal((await stat(mcp)).isFile(), true);
  const help = await run([binPath, '--help']);
  assert.equal(help.code, 0);
  assert.equal(help.stdout, '');
  assert.match(help.stderr, /knolo-box build\|status\|mcp\|init/);
  const missing = await run([binPath]);
  assert.equal(missing.code, 1);
  const unknown = await run([binPath, 'query']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /knolo-box: BOX_CONFIG/);
  const mcpHelp = await run([mcp, '--help']);
  assert.equal(mcpHelp.code, 0);
  assert.equal(mcpHelp.stdout, '');
  assert.match(mcpHelp.stderr, /knolo-mcp --config/);

  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const output = path.join(home, 'out');
    await mkdir(path.join(grok, 'memory-v2', 'topics'), { recursive: true });
    await writeFile(
      path.join(grok, 'memory-v2', 'topics', 'cli.md'),
      'CLI_MEMORY_PHRASE\n'
    );
    const configPath = path.join(home, 'box.json');
    await writeFile(
      configPath,
      `${JSON.stringify({
        output,
        grokHome: grok,
        scopes: {
          files: { roots: [] },
          skills: { roots: [] },
          memory: { roots: [path.join(grok, 'memory-v2')] },
          transcripts: { roots: [] },
        },
      })}\n`
    );
    const built = await run([binPath, 'build', '--config', configPath]);
    assert.equal(built.code, 0, built.stderr);
    const status = JSON.parse(built.stdout);
    assert.equal(status[0].id, 'memory');
    assert.equal(status[0].pinMatches, true);
    assert.equal(status[0].stale, false);
    assert.match(status[0].stateRoot, /^sha256-[a-f0-9]{64}$/);
    const again = await run([binPath, 'status', '--config', configPath]);
    assert.equal(again.code, 0);
    assert.equal(JSON.parse(again.stdout)[0].stateRoot, status[0].stateRoot);
    assert.equal(await main(['build', '--config']), 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

const SKILL_BYTES = '# Skill\n\nINIT_SKILL_PHRASE lives here.\n';
const MANAGED_BYTES = '# Managed\n\nINIT_MANAGED_PHRASE lives here.\n';

async function writeSkillTree(root) {
  const workflows = path.join(root, 'workflows', 'hive');
  const managed = path.join(root, 'managed-skills', 'skills', 'sales');
  await mkdir(workflows, { recursive: true });
  await mkdir(managed, { recursive: true });
  await writeFile(path.join(workflows, 'SKILL.md'), SKILL_BYTES);
  await writeFile(path.join(managed, 'SKILL.md'), MANAGED_BYTES);
}

async function linkSkillTree(home, name, target) {
  const parent = path.join(home, name);
  await mkdir(parent, { recursive: true });
  await symlink(path.join(target, 'workflows'), path.join(parent, 'workflows'));
  await symlink(
    path.join(target, 'managed-skills'),
    path.join(parent, 'managed-skills')
  );
}

test('init follows a real directory and a symlink to the same skills pin', async () => {
  const home = await tempHome();
  const linked = await tempHome();
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    const store = path.join(linked, 'store');
    await writeSkillTree(store);
    await linkSkillTree(linked, 'sand-data', store);
    const realConfig = path.join(home, 'box.json');
    const linkConfig = path.join(linked, 'box.json');
    const real = await initBox({
      configPath: realConfig,
      roots: [home],
      home,
      env: {},
    });
    const viaLink = await initBox({
      configPath: linkConfig,
      roots: [linked],
      home: linked,
      env: {},
    });
    assert.equal(
      real.scopes.skills.roots[0],
      await realpath(path.join(home, 'agent-data', 'workflows'))
    );
    assert.equal(
      viaLink.scopes.skills.roots[0],
      await realpath(path.join(store, 'workflows'))
    );
    assert.equal(
      viaLink.scopes.skills.roots.includes(
        path.join(linked, 'sand-data', 'workflows')
      ),
      false
    );
    const now = new Date('2026-11-04T12:00:00.000Z');
    const realPins = await buildBox(
      await loadBoxConfig(realConfig, {}, home),
      now
    );
    const linkPins = await buildBox(
      await loadBoxConfig(linkConfig, {}, linked),
      now
    );
    assert.equal(
      realPins.scopes.skills.stateRoot,
      linkPins.scopes.skills.stateRoot
    );
    assert.equal(realPins.scopes.skills.sha256, linkPins.scopes.skills.sha256);
    assert.equal(
      realPins.scopes.skills.builtAt,
      linkPins.scopes.skills.builtAt
    );
    assert.deepEqual(real.scopes.files.roots, []);
    assert.deepEqual(real.scopes.memory.roots, []);
    assert.deepEqual(real.scopes.transcripts.roots, []);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(linked, { recursive: true, force: true });
  }
});

test('init records one directory reached through a link and a real path once', async () => {
  const home = await tempHome();
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    await linkSkillTree(home, 'sand-data', path.join(home, 'agent-data'));
    const config = await initBox({
      configPath: path.join(home, 'box.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(config.scopes.skills.roots, [
      await realpath(path.join(home, 'agent-data', 'workflows')),
      await realpath(path.join(home, 'agent-data', 'managed-skills', 'skills')),
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('init refuses two different skill parents and writes no config', async () => {
  const home = await tempHome();
  const configPath = path.join(home, 'box.json');
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    await writeSkillTree(path.join(home, 'sand-data'));
    await writeFile(
      path.join(home, 'sand-data', 'workflows', 'hive', 'SKILL.md'),
      'OTHER_SKILL_PHRASE\n'
    );
    await assert.rejects(
      () => initBox({ configPath, roots: [home], home, env: {} }),
      (error) => {
        assert.equal(error.code, 'BOX_CONFIG');
        assert.match(error.message, /workflows must resolve to one directory/);
        assert.match(
          error.message,
          new RegExp(path.join(home, 'agent-data', 'workflows'))
        );
        assert.match(
          error.message,
          new RegExp(path.join(home, 'sand-data', 'workflows'))
        );
        return true;
      }
    );
    await assert.rejects(() => access(configPath));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('an override skips detection for that role', async () => {
  const home = await tempHome();
  try {
    const custom = path.join(home, 'custom');
    await writeSkillTree(custom);
    await writeSkillTree(path.join(home, 'agent-data'));
    const configPath = path.join(home, 'box.json');
    const config = await initBox({
      configPath,
      roots: [home],
      skills: path.join(custom, 'workflows'),
      home,
      env: {},
    });
    assert.equal(
      config.scopes.skills.roots[0],
      await realpath(path.join(custom, 'workflows'))
    );
    assert.equal(await main(['init', '--config']), 1);
    const flagged = await main(
      [
        'init',
        '--config',
        path.join(home, 'flagged.json'),
        '--root',
        home,
        '--skills',
        path.join(custom, 'workflows'),
      ],
      {},
      home
    );
    assert.equal(flagged, 0);
    const written = JSON.parse(
      await readFile(path.join(home, 'flagged.json'), 'utf8')
    );
    assert.equal(written.scopes.skills.roots[0], config.scopes.skills.roots[0]);
    assert.equal(JSON.stringify(written).includes(os.homedir()), false);
    const fromEnv = await main(
      ['init', '--config', path.join(home, 'env.json'), '--root', home],
      { KNOLO_BOX_SKILLS: path.join(custom, 'workflows') },
      home
    );
    assert.equal(fromEnv, 0);
    const envWritten = JSON.parse(
      await readFile(path.join(home, 'env.json'), 'utf8')
    );
    assert.equal(
      envWritten.scopes.skills.roots[0],
      config.scopes.skills.roots[0]
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('init does not read a secret file beside a candidate', async () => {
  const home = await tempHome();
  const locked = [];
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    const secret = path.join(home, 'agent-data', 'cookie-seeds.json');
    const sibling = path.join(
      home,
      'agent-data',
      'workflows',
      'box-secrets.json'
    );
    await writeFile(secret, 'COOKIE_SEED_SECRET\n', { mode: 0o600 });
    await writeFile(sibling, 'BOX_SECRET_VALUE\n', { mode: 0o600 });
    await chmod(secret, 0o000);
    await chmod(sibling, 0o000);
    locked.push(secret, sibling);
    const config = await initBox({
      configPath: path.join(home, 'box.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.equal(JSON.stringify(config).includes('COOKIE_SEED_SECRET'), false);
    assert.equal(JSON.stringify(config).includes('BOX_SECRET_VALUE'), false);
  } finally {
    await Promise.all(
      locked.map((filePath) => chmod(filePath, 0o600).catch(() => undefined))
    );
    await rm(home, { recursive: true, force: true });
  }
});

test('init skips a symlink whose target is denied', async () => {
  const home = await tempHome();
  try {
    const hidden = path.join(home, 'secrets');
    await writeSkillTree(hidden);
    await linkSkillTree(home, 'agent-data', hidden);
    await writeSkillTree(path.join(home, 'sand-data'));
    const config = await initBox({
      configPath: path.join(home, 'box.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(config.scopes.skills.roots, [
      await realpath(path.join(home, 'sand-data', 'workflows')),
      await realpath(path.join(home, 'sand-data', 'managed-skills', 'skills')),
    ]);
    assert.equal(
      config.scopes.skills.roots.some((root) =>
        root.includes(`${path.sep}secrets${path.sep}`)
      ),
      false
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('init mounts one memory directory and one transcript directory', async () => {
  const home = await tempHome();
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    const memory = path.join(home, 'agent-data', 'memory-v2');
    const sessions = path.join(home, 'agent-data', 'sessions');
    await mkdir(path.join(memory, 'topics'), { recursive: true });
    await mkdir(sessions, { recursive: true });
    const result = await initBox({
      configPath: path.join(home, 'box.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(result.scopes.memory.roots, [await realpath(memory)]);
    assert.deepEqual(result.scopes.transcripts.roots, [
      await realpath(sessions),
    ]);
    assert.deepEqual(result.scopes.files.roots, []);
    assert.match(result.reports.join('\n'), /files: opt-in, left empty/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('init leaves memory empty when none or several directories match', async () => {
  const home = await tempHome();
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    const none = await initBox({
      configPath: path.join(home, 'none.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(none.scopes.memory.roots, []);
    assert.match(none.reports.join('\n'), /memory: no directory found/);
    await mkdir(path.join(home, 'agent-data', 'memory-v2'), {
      recursive: true,
    });
    await mkdir(path.join(home, 'sand-data', 'memory-v2'), {
      recursive: true,
    });
    const many = await initBox({
      configPath: path.join(home, 'many.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(many.scopes.memory.roots, []);
    assert.match(
      many.reports.join('\n'),
      /memory: found more than one directory/
    );
    assert.match(
      many.reports.join('\n'),
      new RegExp(path.join(home, 'agent-data', 'memory-v2'))
    );
    assert.match(
      many.reports.join('\n'),
      new RegExp(path.join(home, 'sand-data', 'memory-v2'))
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('init does not mount a memory directory that resolves to a denied path', async () => {
  const home = await tempHome();
  try {
    await writeSkillTree(path.join(home, 'agent-data'));
    const hidden = path.join(home, 'secrets', 'memory-v2');
    await mkdir(hidden, { recursive: true });
    await symlink(hidden, path.join(home, 'agent-data', 'memory-v2'));
    const result = await initBox({
      configPath: path.join(home, 'box.json'),
      roots: [home],
      home,
      env: {},
    });
    assert.deepEqual(result.scopes.memory.roots, []);
    assert.equal(
      JSON.stringify(result.scopes).includes(`${path.sep}secrets${path.sep}`),
      false
    );
    assert.match(result.reports.join('\n'), /Denied/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a secret in one scope leaves the other scope fresh', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const skillDir = path.join(grok, 'skills', 'notes');
    const topicDir = path.join(grok, 'memory-v2', 'topics');
    await mkdir(skillDir, { recursive: true });
    await mkdir(topicDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), 'BOX_SKILL_CLEAN\n');
    await writeFile(path.join(topicDir, 'note.md'), 'clean memory note\n');
    const config = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [path.join(grok, 'skills')] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await buildBox(config, new Date('2026-11-09T00:00:00.000Z'));
    const secretLine = `ghp_${'a'.repeat(20)}`;
    await writeFile(
      path.join(topicDir, 'note.md'),
      `${secretLine}\nclean memory note\n`
    );
    const status = await boxStatus(config);
    assert.equal(status.find((item) => item.id === 'memory').stale, true);
    assert.equal(status.find((item) => item.id === 'skills').stale, false);
    assert.equal(JSON.stringify(status).includes(secretLine), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the builder does not use the network', () => {
  assert.equal(networkCalls, 0);
});

test('caller identity comes from the box config, then the environment', async () => {
  const home = await tempHome();
  try {
    const configPath = path.join(home, 'box.json');
    const grok = path.join(home, 'grok');
    const topicDir = path.join(grok, 'memory-v2', 'topics');
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      topicDir + '/note.md',
      'IDENTITY_PHRASE stays on one image.\n'
    );
    const stored = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      scopes: {
        files: { roots: [] },
        skills: { roots: [] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await writeFile(configPath, `${JSON.stringify(stored)}\n`);
    const fromEnv = await loadBoxConfig(
      configPath,
      {
        KNOLO_BOX_AGENT_ID: 'env-agent',
        KNOLO_BOX_SESSION_ID: 'env-session',
        KNOLO_BOX_AUTO_REBUILD: 'true',
      },
      home
    );
    assert.equal(fromEnv.agentId, 'env-agent');
    assert.equal(fromEnv.sessionId, 'env-session');
    assert.equal(fromEnv.autoRebuild, true);
    await writeFile(
      configPath,
      `${JSON.stringify({
        ...stored,
        agentId: 'file-agent',
        sessionId: 'file-session',
        autoRebuild: false,
      })}\n`
    );
    const fromFile = await loadBoxConfig(
      configPath,
      {
        KNOLO_BOX_AGENT_ID: 'env-agent',
        KNOLO_BOX_SESSION_ID: 'env-session',
        KNOLO_BOX_AUTO_REBUILD: 'true',
      },
      home
    );
    assert.equal(fromFile.agentId, 'file-agent');
    assert.equal(fromFile.sessionId, 'file-session');
    assert.equal(fromFile.autoRebuild, false);
    assert.equal(fromFile.configPath, configPath);
    const bare = defaultBoxConfig(
      {
        GROK_HOME: grok,
        KNOLO_BOX_AGENT_ID: 'desk',
        KNOLO_BOX_SESSION_ID: 'chat-9',
        KNOLO_BOX_AUTO_REBUILD: '1',
      },
      home
    );
    assert.equal(bare.agentId, 'desk');
    assert.equal(bare.sessionId, 'chat-9');
    assert.equal(bare.autoRebuild, true);
    assert.throws(
      () => defaultBoxConfig({ KNOLO_BOX_AGENT_ID: 'bad id' }, home),
      (error) => error instanceof BoxError && error.code === 'BOX_CONFIG'
    );

    await writeFile(configPath, `${JSON.stringify(stored)}\n`);
    const built = await loadBoxConfig(configPath, {}, home);
    assert.equal(built.agentId, 'box');
    assert.equal(built.sessionId, undefined);
    const pins = await buildBox(built, new Date('2026-11-04T00:00:00.000Z'));
    const policyPath = path.join(built.output, 'policy.json');
    const auditDir = path.join(built.output, 'audit');
    const alpha = box.mcpConfig(
      { ...built, agentId: 'alpha', sessionId: 'chat-a', agents: ['box'] },
      pins,
      policyPath,
      auditDir,
      false
    );
    const beta = box.mcpConfig(
      { ...built, agentId: 'beta', sessionId: 'chat-b', agents: ['box'] },
      pins,
      policyPath,
      auditDir,
      false
    );
    assert.equal(alpha.agentId, 'alpha');
    assert.equal(alpha.sessionId, 'chat-a');
    assert.equal(beta.agentId, 'beta');
    assert.equal(beta.sessionId, 'chat-b');
    assert.equal(alpha.mounts[0].path, beta.mounts[0].path);
    assert.equal(alpha.mounts[0].sha256, beta.mounts[0].sha256);
    assert.deepEqual(alpha.mounts[0].agents, ['alpha']);
    assert.deepEqual(beta.mounts[0].agents, ['beta']);
    const { agentId: _alphaId, sessionId: _alphaSession, ...pluginA } = alpha;
    const { agentId: _betaId, sessionId: _betaSession, ...pluginB } = beta;
    const serviceA = await KnoloOpenClawService.create(pluginA);
    const serviceB = await KnoloOpenClawService.create(pluginB);
    const hitA = await serviceA.search(
      { query: 'IDENTITY_PHRASE', imageIds: ['memory'], limit: 2 },
      { agentId: 'alpha', sessionId: 'chat-a' }
    );
    const hitB = await serviceB.search(
      { query: 'IDENTITY_PHRASE', imageIds: ['memory'], limit: 2 },
      { agentId: 'beta', sessionId: 'chat-b' }
    );
    const receiptA = JSON.parse(
      await readFile(
        path.join(auditDir, `${hitA.receipts[0].receiptId}.json`),
        'utf8'
      )
    );
    const receiptB = JSON.parse(
      await readFile(
        path.join(auditDir, `${hitB.receipts[0].receiptId}.json`),
        'utf8'
      )
    );
    assert.equal(receiptA.caller.agentId, 'alpha');
    assert.equal(receiptA.caller.sessionId, 'chat-a');
    assert.equal(receiptB.caller.agentId, 'beta');
    assert.equal(receiptB.caller.sessionId, 'chat-b');
    assert.notEqual(receiptA.caller.agentId, receiptB.caller.agentId);
    await assert.rejects(
      () =>
        serviceA.search(
          { query: 'IDENTITY_PHRASE', imageIds: ['memory'] },
          { agentId: 'knolo-mcp-test', sessionId: 'chat-a' }
        ),
      (error) => error.code === 'ACCESS_DENIED'
    );

    const plain = box.mcpConfig(built, pins, policyPath, auditDir, false);
    assert.equal(plain.agentId, 'box');
    assert.equal(Object.hasOwn(plain, 'sessionId'), false);
    const plainService = await openService(built.output);
    const plainHit = await plainService.search(
      { query: 'IDENTITY_PHRASE', imageIds: ['memory'], limit: 2 },
      { agentId: 'box' }
    );
    const plainReceipt = JSON.parse(
      await readFile(
        path.join(auditDir, `${plainHit.receipts[0].receiptId}.json`),
        'utf8'
      )
    );
    assert.equal(plainReceipt.caller.agentId, 'box');
    assert.equal(Object.hasOwn(plainReceipt.caller, 'sessionId'), false);
    assert.equal(plainReceipt.version, 'openclaw-knolo-query-v1');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('autoRebuild is off unless the config asks, and then status rebuilds once', async () => {
  const home = await tempHome();
  try {
    const grok = path.join(home, 'grok');
    const topic = path.join(grok, 'memory-v2', 'topics', 'note.md');
    await mkdir(path.dirname(topic), { recursive: true });
    await writeFile(topic, 'REBUILD_PHRASE original line.\n');
    const configPath = path.join(home, 'box.json');
    const stored = {
      output: path.join(home, 'out'),
      grokHome: grok,
      agents: ['box'],
      autoRebuild: false,
      scopes: {
        files: { roots: [] },
        skills: { roots: [] },
        memory: { roots: [path.join(grok, 'memory-v2')] },
        transcripts: { roots: [] },
      },
    };
    await writeFile(configPath, `${JSON.stringify(stored)}\n`);
    const config = await loadBoxConfig(configPath, {}, home);
    assert.equal(config.autoRebuild, false);
    await buildBox(config, new Date('2026-11-04T00:00:00.000Z'));
    await writeFile(topic, 'REBUILD_PHRASE edited while off.\n');
    const off = await boxStatus(config, new Date('2026-11-04T01:00:00.000Z'));
    assert.equal(off[0].stale, true);
    assert.equal(off[0].pinMatches, true);
    assert.equal(off[0].lastAutoRebuild, null);
    const stateOff = off[0].stateRoot;

    stored.autoRebuild = true;
    await writeFile(configPath, `${JSON.stringify(stored)}\n`);
    const enabled = await loadBoxConfig(configPath, {}, home);
    const first = await boxStatus(
      enabled,
      new Date('2026-11-04T02:00:00.000Z')
    );
    assert.equal(first[0].stale, false);
    assert.equal(first[0].pinMatches, true);
    assert.notEqual(first[0].stateRoot, stateOff);
    assert.equal(first[0].lastAutoRebuild.ok, true);
    assert.equal(first[0].lastAutoRebuild.at, '2026-11-04T02:00:00.000Z');
    assert.equal(Object.hasOwn(first[0].lastAutoRebuild, 'reason'), false);
    const raw = JSON.parse(
      await readFile(path.join(enabled.output, 'knolo-mcp.json'), 'utf8')
    );
    assert.equal(raw.autoRebuild.command, process.execPath);
    assert.deepEqual(raw.autoRebuild.args.slice(1), [
      'ensure-fresh',
      '--config',
      configPath,
    ]);
    const service = await openService(enabled.output);
    const found = await service.search(
      { query: 'edited', imageIds: ['memory'], limit: 2 },
      { agentId: 'box' }
    );
    assert.match(found.hits[0].excerpt, /edited while off/);

    await writeFile(topic, 'REBUILD_PHRASE second edit.\n');
    const skipped = await boxStatus(
      enabled,
      new Date('2026-11-04T02:00:01.000Z')
    );
    assert.equal(skipped[0].stale, true);
    assert.equal(skipped[0].stateRoot, first[0].stateRoot);
    assert.equal(skipped[0].lastAutoRebuild.at, first[0].lastAutoRebuild.at);

    const later = await boxStatus(
      enabled,
      new Date('2026-11-04T02:00:03.000Z')
    );
    assert.equal(later[0].stale, false);
    assert.notEqual(later[0].stateRoot, first[0].stateRoot);
    assert.equal(later[0].lastAutoRebuild.ok, true);
    const again = await openService(enabled.output);
    const second = await again.search(
      { query: 'second', imageIds: ['memory'], limit: 2 },
      { agentId: 'box' }
    );
    assert.match(second.hits[0].excerpt, /second edit/);

    const beforeFail = await readFile(path.join(enabled.output, 'memory.v5'));
    await writeFile(
      topic,
      '-----BEGIN PRIVATE KEY-----\nREBUILD_PHRASE secret\n'
    );
    const failed = await boxStatus(
      enabled,
      new Date('2026-11-04T02:00:10.000Z')
    );
    assert.equal(failed[0].stale, true);
    assert.equal(failed[0].stateRoot, later[0].stateRoot);
    assert.equal(failed[0].lastAutoRebuild.ok, false);
    assert.match(failed[0].lastAutoRebuild.reason, /No new image was written/);
    assert.equal(
      failed[0].lastAutoRebuild.reason.includes('PRIVATE KEY'),
      false
    );
    assert.deepEqual(
      await readFile(path.join(enabled.output, 'memory.v5')),
      beforeFail
    );

    await writeFile(topic, 'REBUILD_PHRASE recovered line.\n');
    const held = await boxStatus(enabled, new Date('2026-11-04T02:00:11.000Z'));
    assert.equal(held[0].stale, true);
    assert.equal(held[0].stateRoot, later[0].stateRoot);
    assert.equal(held[0].lastAutoRebuild.ok, false);
    const recovered = await boxStatus(
      enabled,
      new Date('2026-11-04T02:00:13.000Z')
    );
    assert.equal(recovered[0].stale, false);
    assert.equal(recovered[0].lastAutoRebuild.ok, true);
    assert.notEqual(recovered[0].stateRoot, later[0].stateRoot);
    assert.equal(
      await main(['ensure-fresh', '--config', configPath], {}, home),
      0
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
