import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.pytest_cache',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativeDirectory = path.relative(
      root,
      path.join(directory, entry.name)
    );
    if (
      entry.isDirectory() &&
      (relativeDirectory === 'docs/v6' || relativeDirectory === 'docs/v5.5')
    )
      continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(fullPath));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name))
      files.push(fullPath);
  }
  return files;
}

function headingSlugs(markdown) {
  const slugs = new Set();
  const counts = new Map();
  const headingPattern = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;
  for (const match of markdown.matchAll(headingPattern)) {
    const heading = match[1]
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!heading) continue;
    const count = counts.get(heading) ?? 0;
    counts.set(heading, count + 1);
    slugs.add(count === 0 ? heading : `${heading}-${count}`);
  }
  return slugs;
}

function isExternalTarget(target) {
  return target.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

const markdownFiles = collectMarkdownFiles(root);
const failures = [];
const linkPattern =
  /(!?)\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;

for (const filename of markdownFiles) {
  const markdown = readFileSync(filename, 'utf8');
  const sourceRelative = path.relative(root, filename);
  const sourceSlugs = headingSlugs(markdown);

  for (const match of markdown.matchAll(linkPattern)) {
    if (match[1] === '!') continue;
    const rawTarget = match[2].startsWith('<')
      ? match[2].slice(1, -1)
      : match[2];
    if (isExternalTarget(rawTarget)) continue;

    const [rawPath, rawFragment] = rawTarget.split('#', 2);
    const fragment = rawFragment ? decodeURIComponent(rawFragment) : null;
    const targetPath = decodeURIComponent(rawPath);
    const resolved = targetPath
      ? path.resolve(path.dirname(filename), targetPath)
      : filename;

    if (!existsSync(resolved)) {
      failures.push(`${sourceRelative}: missing target ${rawTarget}`);
      continue;
    }

    if (!fragment || !/\.mdx?$/i.test(resolved)) continue;
    const targetMarkdown =
      resolved === filename ? markdown : readFileSync(resolved, 'utf8');
    const targetSlugs =
      resolved === filename ? sourceSlugs : headingSlugs(targetMarkdown);
    assert.equal(
      targetSlugs.has(fragment.toLowerCase()),
      true,
      `${sourceRelative}: missing anchor ${rawTarget}`
    );
  }
}

assert.deepEqual(failures, [], failures.join('\n'));
console.log(
  `Documentation link audit passed for ${markdownFiles.length} Markdown files.`
);
