import { createHash, type Hash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { openKnowledgeImageV5 } from '@knolo/core';
import { citationHeader, sliceText } from './chunk.js';
import type { BoxConfig, BoxScopeName } from './config.js';
import { isDeniedPath, isInsideRoot } from './deny.js';
import {
  chatFileTooLarge,
  FILE_BYTE_CAP,
  SECRET_PATTERN,
  SESSION_BYTE_CAP,
  SESSION_COUNT_CAP,
  turnTooLarge,
} from './limits.js';
import { BoxError } from './errors.js';

export type IndexedChunk = {
  scope: BoxScopeName;
  source: string;
  locator: string;
  when?: string;
  agent?: string;
  text: string;
};

export type SkippedPath = {
  path: string;
  reason: 'missing-root' | 'too-large' | 'unreadable-image';
};

export type ScopeCorpus = {
  scope: BoxScopeName;
  chunks: IndexedChunk[];
  sourceDigest: string;
  skipped: SkippedPath[];
};

const FILE_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.markdown']);
const encoder = new TextEncoder();

export async function digestScopeSources(input: {
  scope: BoxScopeName;
  roots: readonly string[];
  grokHome: string;
}): Promise<{ sourceDigest: string | null; missingRoot: boolean }> {
  const scopes: BoxConfig['scopes'] = {
    files: { roots: [] },
    skills: { roots: [] },
    memory: { roots: [] },
    transcripts: { roots: [] },
  };
  scopes[input.scope] = { roots: [...input.roots] };
  const config: BoxConfig = {
    output: input.grokHome,
    grokHome: input.grokHome,
    agents: ['box'],
    scopes,
  };
  try {
    const corpora = await collectCorpora(config);
    const corpus = corpora.find((item) => item.scope === input.scope);
    if (!corpus) return { sourceDigest: null, missingRoot: true };
    return {
      sourceDigest: corpus.sourceDigest,
      missingRoot: scopeMissingRoot(input.roots, corpus),
    };
  } catch (error) {
    if (isUnreadableSource(error)) {
      return { sourceDigest: null, missingRoot: true };
    }
    throw error;
  }
}

export function scopeMissingRoot(
  roots: readonly string[],
  corpus: ScopeCorpus
): boolean {
  return (
    roots.length === 0 ||
    roots.some((root) =>
      corpus.skipped.some(
        (item) => item.reason === 'missing-root' && item.path === root
      )
    )
  );
}

export function isUnreadableSource(error: unknown): boolean {
  if (error instanceof BoxError && error.code === 'BOX_SECRET') return true;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR'
  );
}

export async function collectCorpora(
  config: BoxConfig
): Promise<ScopeCorpus[]> {
  const corpora: ScopeCorpus[] = [];
  for (const scope of ['skills', 'files', 'memory', 'transcripts'] as const) {
    const corpus =
      scope === 'transcripts'
        ? await collectTranscripts(config)
        : await collectFiles(config, scope);
    assertNoSecrets(corpus.chunks);
    corpora.push(corpus);
  }
  return corpora;
}

export function selectNewestSessions<
  T extends { updatedAt: string; path: string },
>(sessions: readonly T[], limit = SESSION_COUNT_CAP): T[] {
  return [...sessions]
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
}

async function collectFiles(
  config: BoxConfig,
  scope: 'files' | 'skills' | 'memory'
): Promise<ScopeCorpus> {
  const skipped: SkippedPath[] = [];
  const files: Array<{ abs: string; source: string; root: string }> = [];
  for (const root of config.scopes[scope].roots) {
    let realRoot: string;
    try {
      const info = await lstat(root);
      if (!info.isDirectory()) {
        skipped.push({ path: root, reason: 'missing-root' });
        continue;
      }
      realRoot = await realpath(root);
    } catch {
      skipped.push({ path: root, reason: 'missing-root' });
      continue;
    }
    await walk(realRoot, async (abs) => {
      if (!wantedFile(scope, realRoot, abs)) return;
      const info = await stat(abs);
      if (info.size > FILE_BYTE_CAP) {
        skipped.push({
          path: displayPath(abs, config, realRoot),
          reason: 'too-large',
        });
        return;
      }
      files.push({
        abs,
        source: displayPath(abs, config, realRoot),
        root: realRoot,
      });
    });
  }
  files.sort((left, right) => left.source.localeCompare(right.source));
  const chunks: IndexedChunk[] = [];
  const digest = createHash('sha256');
  for (const file of files) {
    const text = await readFile(file.abs, 'utf8');
    digest.update(file.source);
    digest.update('\0');
    digest.update(text);
    digest.update('\0');
    const markdown = file.abs.endsWith('.txt') === false;
    for (const slice of sliceText(text, markdown)) {
      chunks.push({
        scope,
        source: file.source,
        locator: `lines ${slice.startLine}-${slice.endLine}`,
        text: citationHeader({
          source: file.source,
          locator: `lines ${slice.startLine}-${slice.endLine}`,
          body: slice.text,
        }),
      });
    }
    if (scope === 'skills') {
      chunks.push(
        ...(await bundledSkillChunks(
          file.abs,
          file.root,
          config,
          digest,
          skipped
        ))
      );
    }
  }
  return {
    scope,
    chunks,
    sourceDigest: digest.digest('hex'),
    skipped,
  };
}

async function bundledSkillChunks(
  skillFile: string,
  scopeRoot: string,
  config: BoxConfig,
  digest: Hash,
  skipped: SkippedPath[]
): Promise<IndexedChunk[]> {
  const dir = path.dirname(skillFile);
  const imagePath = path.join(dir, 'knowledge.v5');
  const policyPath = path.join(dir, 'policy.json');
  let imageInfo;
  let policyInfo;
  try {
    imageInfo = await stat(imagePath);
    policyInfo = await stat(policyPath);
  } catch {
    return [];
  }
  if (!imageInfo.isFile() || !policyInfo.isFile()) return [];
  const imageSource = displayPath(imagePath, config, scopeRoot);
  if (imageInfo.size > FILE_BYTE_CAP) {
    skipped.push({ path: imageSource, reason: 'too-large' });
    return [];
  }
  const bytes = await readFile(imagePath);
  digest.update(imageSource);
  digest.update('\0');
  digest.update(bytes);
  digest.update('\0');
  let objects: Array<{ kind: string; bytes: Uint8Array }>;
  try {
    objects = openKnowledgeImageV5(bytes).materialize().objects;
  } catch {
    skipped.push({ path: imageSource, reason: 'unreadable-image' });
    return [];
  }
  const chunks: IndexedChunk[] = [];
  for (const object of objects) {
    if (object.kind !== 'chunk') continue;
    const text = Buffer.from(object.bytes).toString('utf8');
    for (const slice of sliceText(text, true)) {
      const locator = `lines ${slice.startLine}-${slice.endLine}`;
      chunks.push({
        scope: 'skills',
        source: imageSource,
        locator,
        text: citationHeader({
          source: imageSource,
          locator,
          body: slice.text,
        }),
      });
    }
  }
  return chunks;
}

async function collectTranscripts(config: BoxConfig): Promise<ScopeCorpus> {
  const skipped: SkippedPath[] = [];
  const found: Array<{
    dir: string;
    root: string;
    updatedAt: string;
  }> = [];
  for (const root of config.scopes.transcripts.roots) {
    let realRoot: string;
    try {
      const info = await lstat(root);
      if (!info.isDirectory()) {
        skipped.push({ path: root, reason: 'missing-root' });
        continue;
      }
      realRoot = await realpath(root);
    } catch {
      skipped.push({ path: root, reason: 'missing-root' });
      continue;
    }
    await walk(realRoot, async (abs) => {
      if (path.basename(abs) !== 'summary.json') return;
      const summary = await readSummary(abs);
      found.push({
        dir: path.dirname(abs),
        root: realRoot,
        updatedAt: summary.updated_at ?? summary.created_at ?? '',
      });
    });
  }
  const selected = selectNewestSessions(
    found.map((item) => ({
      ...item,
      path: item.dir,
      updatedAt: item.updatedAt,
    }))
  );
  const chunks: IndexedChunk[] = [];
  const digest = createHash('sha256');
  for (const session of selected) {
    const summaryPath = path.join(session.dir, 'summary.json');
    const summary = await readSummary(summaryPath);
    const source = displayPath(summaryPath, config, session.root);
    const when = summary.updated_at ?? summary.created_at;
    const agent = summary.agent_name;
    const summaryBody = summaryText(summary);
    digest.update(source);
    digest.update('\0');
    digest.update(summaryBody);
    digest.update('\0');
    if (summaryBody) {
      const lines = summaryBody.split('\n').length;
      chunks.push(
        chunk({
          source,
          locator: `lines 1-${lines}`,
          when,
          agent,
          body: summaryBody,
        })
      );
    }
    const chatPath = path.join(session.dir, 'chat_history.jsonl');
    try {
      const info = await stat(chatPath);
      if (chatFileTooLarge(info.size)) {
        skipped.push({
          path: displayPath(chatPath, config, session.root),
          reason: 'too-large',
        });
      } else {
        const raw = await readFile(chatPath, 'utf8');
        let turn = 0;
        let keptBytes = 0;
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          let row: { type?: unknown; content?: unknown };
          try {
            row = JSON.parse(line) as { type?: unknown; content?: unknown };
          } catch {
            continue;
          }
          if (row.type !== 'user' && row.type !== 'assistant') continue;
          turn += 1;
          const text = textFromContent(row.content).trim();
          if (!text || turnTooLarge(text)) continue;
          const size = Buffer.byteLength(text);
          if (keptBytes + size > SESSION_BYTE_CAP) break;
          keptBytes += size;
          const chatSource = displayPath(chatPath, config, session.root);
          const locator = `turn ${turn}`;
          digest.update(chatSource);
          digest.update('\0');
          digest.update(String(turn));
          digest.update('\0');
          digest.update(text);
          digest.update('\0');
          chunks.push(
            chunk({
              source: chatSource,
              locator,
              when,
              agent,
              body: text,
            })
          );
        }
      }
    } catch {
      // A session can have a summary and no chat file.
    }
  }
  return {
    scope: 'transcripts',
    chunks,
    sourceDigest: digest.digest('hex'),
    skipped,
  };
}

function chunk(input: {
  source: string;
  locator: string;
  when?: string;
  agent?: string;
  body: string;
}): IndexedChunk {
  return {
    scope: 'transcripts',
    source: input.source,
    locator: input.locator,
    ...(input.when ? { when: input.when } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    text: citationHeader(input),
  };
}

function summaryText(summary: SessionSummary): string {
  return [
    summary.agent_name ? `agent: ${summary.agent_name}` : '',
    summary.generated_title ? `title: ${summary.generated_title}` : '',
    summary.session_summary ? `summary: ${summary.session_summary}` : '',
    summary.created_at ? `created: ${summary.created_at}` : '',
    summary.updated_at ? `updated: ${summary.updated_at}` : '',
    summary.info?.cwd ? `cwd: ${summary.info.cwd}` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

type SessionSummary = {
  agent_name?: string;
  generated_title?: string;
  session_summary?: string;
  created_at?: string;
  updated_at?: string;
  info?: { cwd?: string };
};

async function readSummary(filePath: string): Promise<SessionSummary> {
  try {
    const parsed = JSON.parse(
      await readFile(filePath, 'utf8')
    ) as SessionSummary;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function textFromContent(content: unknown): string {
  if (typeof content !== 'string') return '';
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return content;
  try {
    return textFromJson(JSON.parse(trimmed));
  } catch {
    return content;
  }
}

function textFromJson(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromJson(item))
      .filter((item) => item.length > 0)
      .join('\n');
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (record.type === 'tool_use' || record.type === 'tool_result') return '';
  return ['text', 'content']
    .map((key) => textFromJson(record[key]))
    .filter((item) => item.length > 0)
    .join('\n');
}

function wantedFile(
  scope: 'files' | 'skills' | 'memory',
  root: string,
  abs: string
): boolean {
  const name = path.basename(abs);
  if (scope === 'skills') return name === 'SKILL.md';
  if (scope === 'memory') {
    const relative = path.relative(root, abs).split(path.sep).join('/');
    return (
      /(?:^|\/)topics\/[^/]+\.md$/u.test(relative) ||
      /(?:^|\/)observations\/_inbox\/[^/]+\.md$/u.test(relative)
    );
  }
  return FILE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function walk(
  root: string,
  visit: (abs: string) => Promise<void>
): Promise<void> {
  const seen = new Set<string>();
  async function descend(directory: string): Promise<void> {
    const realDirectory = await realpath(directory);
    if (
      !isInsideRoot(root, realDirectory) ||
      seen.has(realDirectory) ||
      deniedResolvedPath(root, realDirectory)
    ) {
      return;
    }
    seen.add(realDirectory);
    const entries = await readdir(realDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (isDeniedPath(entry.name)) continue;
      const abs = path.join(realDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(abs);
        } catch {
          continue;
        }
        if (!isInsideRoot(root, target) || deniedResolvedPath(root, target)) {
          continue;
        }
        const info = await stat(target);
        if (info.isDirectory()) await descend(target);
        else if (info.isFile()) await visit(target);
        continue;
      }
      if (entry.isDirectory()) {
        await descend(abs);
        continue;
      }
      if (entry.isFile()) await visit(abs);
    }
  }
  await descend(root);
}

function deniedResolvedPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && isDeniedPath(relative);
}

function displayPath(
  abs: string,
  config: BoxConfig,
  scopeRoot: string
): string {
  if (isInsideRoot(config.grokHome, abs)) {
    return path.relative(config.grokHome, abs).split(path.sep).join('/');
  }
  const relative = path.relative(scopeRoot, abs).split(path.sep).join('/');
  return `${path.basename(scopeRoot)}/${relative}`;
}

function assertNoSecrets(chunks: readonly IndexedChunk[]): void {
  for (const chunk of chunks) {
    if (SECRET_PATTERN.test(chunk.text)) {
      throw new BoxError(
        'BOX_SECRET',
        'A private-key or token pattern matched indexed text. No new image was written.'
      );
    }
  }
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}
