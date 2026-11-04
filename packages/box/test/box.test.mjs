import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  const { agentId: _agentId, ...plugin } = raw;
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
    for (const mount of raw.mounts) {
      assert.equal(path.isAbsolute(mount.path), true);
      assert.equal(mount.principal, 'box:reader');
    }
    const shared = JSON.parse(
      await readFile(path.join(output, 'knolo-mcp-shared.json'), 'utf8')
    );
    assert.deepEqual(
      shared.mounts.map((mount) => mount.id),
      ['files', 'skills']
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
    const status = service.status(caller);
    assert.equal(Object.hasOwn(status[0], 'builtAt'), false);
    const printed = await boxStatus(config);
    assert.equal(printed.find((item) => item.id === 'memory').pinMatches, true);
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
    const edited = await buildBox(config, new Date('2026-11-06T03:00:00.000Z'));
    assert.notEqual(
      edited.scopes.memory.stateRoot,
      pins.scopes.memory.stateRoot
    );
    assert.equal(edited.scopes.memory.builtAt, '2026-11-06T03:00:00.000Z');
    assert.equal(edited.scopes.skills.stateRoot, pins.scopes.skills.stateRoot);
    assert.equal(edited.scopes.skills.builtAt, pins.scopes.skills.builtAt);
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
  assert.match(help.stderr, /knolo-box build\|status\|mcp/);
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
    assert.match(status[0].stateRoot, /^sha256-[a-f0-9]{64}$/);
    const again = await run([binPath, 'status', '--config', configPath]);
    assert.equal(again.code, 0);
    assert.equal(JSON.parse(again.stdout)[0].stateRoot, status[0].stateRoot);
    assert.equal(await main(['build', '--config']), 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the builder does not use the network', () => {
  assert.equal(networkCalls, 0);
});
