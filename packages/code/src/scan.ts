import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { CodeImageError } from './errors.js';

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_CHUNKS_PER_FILE = 200;
export const MAX_DOCS = 10_000;
export const PYTHON_CHUNKER = 'python-scan-v1';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
]);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.knolo',
  'coverage',
  '__pycache__',
]);
const KIND_ORDER = {
  structure: 0,
  class: 1,
  method: 2,
  function: 3,
  export: 4,
} as const;

export type CodeKind = keyof typeof KIND_ORDER;

export type CodeChunk = {
  id: string;
  path: string;
  start: number;
  end: number;
  kind: CodeKind;
  name: string;
  text: string;
  signature: string;
};

export function typescriptChunkerId(): string {
  return `typescript-sourcefile/${ts.version}`;
}

export async function scanWorkspace(root: string): Promise<CodeChunk[]> {
  const resolved = path.resolve(root);
  const files = await collectFiles(resolved);
  if (files.length === 0) {
    throw new CodeImageError(
      'CODE_NO_SOURCES',
      'No TypeScript, JavaScript, or Python files were found.'
    );
  }
  const chunks: CodeChunk[] = [];
  for (const file of files) {
    const relative = toPosix(path.relative(resolved, file));
    assertPortablePath(relative);
    const bytes = await readFile(file);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new CodeImageError(
        'CODE_FILE_TOO_LARGE',
        `${relative} is larger than ${MAX_FILE_BYTES} bytes.`
      );
    }
    const text = bytes.toString('utf8');
    const extracted =
      path.extname(file) === '.py'
        ? scanPython(relative, text)
        : scanTypeScript(relative, text);
    if (extracted.length > MAX_CHUNKS_PER_FILE) {
      throw new CodeImageError(
        'CODE_TOO_MANY_CHUNKS',
        `${relative} has more than ${MAX_CHUNKS_PER_FILE} chunks.`
      );
    }
    chunks.push(...extracted);
    chunks.push(structureChunk(relative, text, extracted));
  }
  chunks.sort(compareChunks);
  assignUniqueIds(chunks);
  if (chunks.length > MAX_DOCS) {
    throw new CodeImageError(
      'CODE_TOO_MANY_CHUNKS',
      `The workspace has more than ${MAX_DOCS} chunks.`
    );
  }
  return chunks;
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  await walk(root, root, found);
  found.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return found;
}

async function walk(
  root: string,
  directory: string,
  found: string[]
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(full);
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new CodeImageError(
          'CODE_PATH_ESCAPE',
          `${toPosix(path.relative(root, full))} points outside the root.`
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      await walk(root, full, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isSourceFile(entry.name)) continue;
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new CodeImageError(
        'CODE_PATH_ESCAPE',
        `${entry.name} points outside the root.`
      );
    }
    found.push(full);
  }
}

function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts') || name.endsWith('.min.js')) return false;
  return SOURCE_EXTENSIONS.has(path.extname(name));
}

function scanTypeScript(filePath: string, text: string): CodeChunk[] {
  const source = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath)
  );
  const chunks: CodeChunk[] = [];
  const visit = (node: ts.Node, insideClass: boolean) => {
    if (ts.isClassDeclaration(node)) {
      const name = nodeName(node.name, 'default');
      chunks.push(nodeChunk(source, filePath, node, 'class', name));
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (
      insideClass &&
      (ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node))
    ) {
      const name = ts.isConstructorDeclaration(node)
        ? 'constructor'
        : nodeName(node.name, 'anon');
      chunks.push(nodeChunk(source, filePath, node, 'method', name));
    } else if (ts.isFunctionDeclaration(node)) {
      chunks.push(
        nodeChunk(
          source,
          filePath,
          node,
          'function',
          nodeName(node.name, 'default')
        )
      );
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (hasExport(node)) {
        chunks.push(
          nodeChunk(
            source,
            filePath,
            node,
            'export',
            nodeName(node.name, 'default')
          )
        );
      }
    } else if (ts.isVariableStatement(node) && hasExport(node)) {
      for (const declaration of node.declarationList.declarations) {
        const name = nodeName(declaration.name, 'default');
        const initializer = declaration.initializer;
        const kind: CodeKind =
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer))
            ? 'function'
            : 'export';
        chunks.push(nodeChunk(source, filePath, node, kind, name));
      }
    } else if (ts.isExportDeclaration(node)) {
      chunks.push(nodeChunk(source, filePath, node, 'export', 'exports'));
    }
    ts.forEachChild(node, (child) => visit(child, insideClass));
  };
  visit(source, false);
  return chunks;
}

function nodeChunk(
  source: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  kind: CodeKind,
  name: string
): CodeChunk {
  const range = lineRange(source, node);
  const safeName = sanitizeName(name);
  return {
    id: chunkId(filePath, range.start, range.end, kind, safeName),
    path: filePath,
    start: range.start,
    end: range.end,
    kind,
    name: safeName,
    text: node.getText(source).trim(),
    signature: signatureOf(source, node),
  };
}

function signatureOf(source: ts.SourceFile, node: ts.Node): string {
  const ranges = bodyRanges(source, node);
  const start = node.getStart(source);
  const end = node.getEnd();
  if (ranges.length === 0) return trimTrailing(source.text.slice(start, end));
  let cursor = start;
  let text = '';
  for (const range of ranges) {
    if (range.start < cursor || range.end > end) continue;
    text += source.text.slice(cursor, range.start);
    cursor = range.end;
  }
  text += source.text.slice(cursor, end);
  return trimTrailing(text);
}

function bodyRanges(
  source: ts.SourceFile,
  node: ts.Node
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (current: ts.Node) => {
    if (isFunctionLike(current) && current.body) {
      ranges.push({
        start: current.body.getStart(source),
        end: current.body.getEnd(),
      });
      return;
    }
    if (ts.isClassStaticBlockDeclaration(current)) {
      ranges.push({
        start: current.body.getStart(source),
        end: current.body.getEnd(),
      });
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  ranges.sort((left, right) => left.start - right.start);
  return ranges;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

function scanPython(filePath: string, text: string): CodeChunk[] {
  const lines = text.split(/\r?\n/u);
  const chunks: CodeChunk[] = [];
  const classIndents: number[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const indent = leadingSpaces(line);
    while (
      classIndents.length > 0 &&
      indent <= (classIndents[classIndents.length - 1] ?? -1)
    ) {
      classIndents.pop();
    }
    const matched = /^( *)(?:async\s+)?def\s+([A-Za-z_]\w*)\b/u.exec(line);
    const classMatched = /^( *)class\s+([A-Za-z_]\w*)\b/u.exec(line);
    const found = classMatched ?? matched;
    if (!found) {
      index += 1;
      continue;
    }
    let start = index;
    while (start > 0) {
      const previous = lines[start - 1] ?? '';
      if (
        leadingSpaces(previous) === indent &&
        previous.trim().startsWith('@')
      ) {
        start -= 1;
        continue;
      }
      break;
    }
    const end = pythonBlockEnd(lines, index, indent);
    const name = sanitizeName(found[2] ?? 'anon');
    const kind: CodeKind = classMatched
      ? 'class'
      : classIndents.length > 0
        ? 'method'
        : 'function';
    const body = lines.slice(start, end).join('\n').trim();
    const signature = lines
      .slice(start, index + 1)
      .map((entry) => entry.trim())
      .join('\n');
    chunks.push({
      id: chunkId(filePath, start + 1, end, kind, name),
      path: filePath,
      start: start + 1,
      end,
      kind,
      name,
      text: body,
      signature,
    });
    if (classMatched) classIndents.push(indent);
    index += 1;
  }
  return chunks;
}

function pythonBlockEnd(
  lines: string[],
  header: number,
  indent: number
): number {
  let cursor = header + 1;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? '';
    if (line.trim() === '') {
      cursor += 1;
      continue;
    }
    if (leadingSpaces(line) <= indent) break;
    cursor += 1;
  }
  return cursor;
}

function structureChunk(
  filePath: string,
  text: string,
  chunks: CodeChunk[]
): CodeChunk {
  const lines = text.split(/\r?\n/u);
  const signatures = chunks.map((chunk) => chunk.signature);
  const body = [`file ${filePath}`, ...signatures].join('\n');
  return {
    id: `structure/${filePath}`,
    path: filePath,
    start: 1,
    end: Math.max(1, lines.length),
    kind: 'structure',
    name: sanitizeName(path.posix.basename(filePath).replace(/\.[^.]+$/u, '')),
    text: `${body}\n`,
    signature: `file ${filePath}`,
  };
}

function compareChunks(left: CodeChunk, right: CodeChunk): number {
  return (
    compareText(left.path, right.path) ||
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    left.start - right.start ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id)
  );
}

function assignUniqueIds(chunks: CodeChunk[]): void {
  const seen = new Map<string, number>();
  for (const chunk of chunks) {
    const count = seen.get(chunk.id) ?? 0;
    seen.set(chunk.id, count + 1);
    if (count === 0) continue;
    const suffix = `-${count + 1}`;
    const base = chunk.id.slice(0, Math.max(1, 200 - suffix.length));
    chunk.id = `${base}${suffix}`;
  }
}

function chunkId(
  filePath: string,
  start: number,
  end: number,
  kind: CodeKind,
  name: string
): string {
  return `chunk/${filePath}#L${start}-L${end}/${kind}/${name}`;
}

function lineRange(
  source: ts.SourceFile,
  node: ts.Node
): { start: number; end: number } {
  const start =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const endPosition = Math.max(node.getStart(source), node.getEnd() - 1);
  const end = source.getLineAndCharacterOfPosition(endPosition).line + 1;
  return { start, end: Math.max(start, end) };
}

function nodeName(name: ts.Node | undefined, fallback: string): string {
  if (!name) return fallback;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text.replace(/^#/u, '');
  }
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return fallback;
}

function hasExport(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/gu, '_').replace(/^_+/u, '');
  const token = cleaned.slice(0, 64);
  if (!token) return 'anon';
  if (!/^[A-Za-z_$]/u.test(token)) return `n_${token}`.slice(0, 64);
  return token;
}

function assertPortablePath(filePath: string): void {
  if (filePath.includes('#') || /[[\]\n\r\0]/u.test(filePath)) {
    throw new CodeImageError(
      'CODE_PATH_ESCAPE',
      `${filePath} contains a character the chunk id cannot store.`
    );
  }
}

function leadingSpaces(line: string): number {
  return /^ */u.exec(line)?.[0].length ?? 0;
}

function trimTrailing(text: string): string {
  return text.replace(/\s+$/u, '');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
