/**
 * Run pinned Knolo CLI checks and write a pass/fail table.
 * The action adds no verification rules. Exit status and CLI output decide the row.
 * SATISFIED is not a truth verdict. This runner never claims a proposition is proven.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

const input = readInputs();
const failOnDiff = booleanInput(input['fail-on-diff'], false);
const wantSummary = booleanInput(input.summary, true);
const attestationArgs = splitArgs(String(input['attestation-args'] ?? ''));
const rows = [];

collect('packs', input.packs, (file) => {
  rows.push(check('pack verify', file, ['verify', file], acceptPack));
  if (input['diff-base'])
    rows.push(diffAgainstBase(file, String(input['diff-base'])));
});
collect('images', input.images, (file) => {
  rows.push(check('v5 health', file, ['v5', 'health', file], acceptHealth));
});
collect('kar-packages', input['kar-packages'], (file) => {
  rows.push(
    check(
      'kar package verify',
      file,
      ['kar', 'package', 'verify', file],
      acceptMarked('KAR BUNDLE VERIFIED')
    )
  );
});
collectLiteral('kar-graphs', input['kar-graphs'], (entry) => {
  const [image, graph] = pair(entry, 2, 'kar-graphs');
  rows.push(
    check(
      'kar graph check',
      label([image, graph]),
      ['kar', 'graph', 'check', '--image', image, '--graph', graph],
      acceptMarked('CEG BOUND')
    )
  );
});
collect('kar-dossiers', input['kar-dossiers'], (file) => {
  rows.push(
    check(
      'kar dossier verify',
      file,
      ['kar', 'dossier', 'verify', file],
      acceptExact(['VERIFIED'])
    )
  );
});
collect('kar-coverage', input['kar-coverage'], (file) => {
  rows.push(
    check(
      'kar coverage verify',
      file,
      ['kar', 'coverage', 'verify', file],
      acceptExact(['VERIFIED'])
    )
  );
});
collect('compositions', input.compositions, (file) => {
  rows.push(
    check(
      'compose verify',
      file,
      ['compose', 'verify', file],
      acceptExact(['VERIFIED', 'VERIFIED digest-bound'])
    )
  );
});
collect('attestations', input.attestations, (file) => {
  rows.push(
    check(
      'verify-attestation',
      file,
      ['verify-attestation', file, ...attestationArgs],
      acceptExact(['VERIFIED', 'VERIFIED content-only'])
    )
  );
});
collectLiteral('cortex-traces', input['cortex-traces'], (entry) => {
  const [image, answer, graph] = pair(entry, [2, 3], 'cortex-traces');
  const args = ['cortex', 'verify', '--image', image, '--answer', answer];
  if (graph) args.push('--graph', graph);
  rows.push(check('cortex verify', label([image, answer]), args, acceptCortex));
});
collectLiteral('diff-pairs', input['diff-pairs'], (entry) => {
  const [left, right] = pair(entry, 2, 'diff-pairs');
  rows.push(
    check(
      'pack diff',
      label([left, right]),
      argsForDiff(left, right),
      acceptPackDiff
    )
  );
});
collectLiteral('kar-graph-diffs', input['kar-graph-diffs'], (entry) => {
  const [before, after] = pair(entry, 2, 'kar-graph-diffs');
  rows.push(
    check(
      'kar graph diff',
      label([before, after]),
      ['kar', 'graph', 'diff', before, after],
      acceptGraphDiff
    )
  );
});

if (rows.length === 0) {
  rows.push({
    artifact: '(none)',
    check: 'selection',
    status: 'fail',
    root: '',
    detail: 'Select at least one artifact.',
  });
}

const passed = rows.every(
  (row) => row.status === 'pass' || row.status === 'changed'
);
const resultsPath = writeResults(rows);
writeSummary(rows);
setOutput('passed', passed ? 'true' : 'false');
setOutput('results', resultsPath);
process.exit(passed ? 0 : 1);

function readInputs() {
  const raw = process.env.INPUTS_JSON;
  if (!raw) {
    console.error('knolo-verify: INPUTS_JSON is required.');
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    return parsed;
  } catch (error) {
    console.error(
      `knolo-verify: INPUTS_JSON is not an object (${error instanceof Error ? error.message : error}).`
    );
    process.exit(1);
  }
}

function booleanInput(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  console.error(
    `knolo-verify: expected true or false, received ${JSON.stringify(value)}.`
  );
  process.exit(1);
}

function collectLiteral(name, value, visit) {
  for (const entry of lines(value)) {
    try {
      visit(entry);
    } catch (error) {
      rows.push(failed(entry, name, error));
    }
  }
}

function collect(name, value, visit) {
  let entries;
  try {
    entries = lines(value).flatMap(expandPattern);
  } catch (error) {
    rows.push(failed(name, name, error));
    return;
  }
  for (const entry of entries) {
    try {
      visit(entry);
    } catch (error) {
      rows.push(failed(entry, name, error));
    }
  }
}

function lines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function expandPattern(entry) {
  if (!/[*?]/.test(entry)) return [path.resolve(workspace, entry)];
  const absolute = path.resolve(workspace, entry);
  const segments = absolute.split(path.sep).filter((part) => part.length > 0);
  const found = [];
  walk(path.parse(absolute).root, segments, 0, found);
  return found.length > 0 ? found.sort() : [absolute];
}

function walk(dir, segments, index, found) {
  if (index === segments.length) {
    found.push(dir);
    return;
  }
  const segment = segments[index];
  if (!segment.includes('*') && !segment.includes('?')) {
    walk(path.join(dir, segment), segments, index + 1, found);
    return;
  }
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (segment === '**') {
    walk(dir, segments, index + 1, found);
    for (const name of names) {
      if (name.isSymbolicLink() || !name.isDirectory()) continue;
      walk(path.join(dir, name.name), segments, index, found);
    }
    return;
  }
  const matcher = globToRegExp(segment);
  for (const name of names) {
    if (name.isSymbolicLink() || !matcher.test(name.name)) continue;
    walk(path.join(dir, name.name), segments, index + 1, found);
  }
}

function globToRegExp(segment) {
  let pattern = '^';
  for (const char of segment) {
    if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[\\^$+.|(){}\[\]]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`);
}

function pair(entry, count, label) {
  const parts = String(entry)
    .split('=')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const allowed = Array.isArray(count) ? count : [count];
  if (!allowed.includes(parts.length)) {
    throw new Error(
      `${label} entry must contain ${allowed.join(' or ')} "="-separated paths.`
    );
  }
  return parts.map((part) => path.resolve(workspace, part));
}

function splitArgs(text) {
  const args = [];
  const source = String(text ?? '').trim();
  if (!source) return args;
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  let consumed = 0;
  while ((match = pattern.exec(source))) {
    if (
      match.index !== consumed &&
      source.slice(consumed, match.index).trim() !== ''
    ) {
      throw new Error('attestation-args could not be split.');
    }
    args.push(match[1] ?? match[2] ?? match[3]);
    consumed = pattern.lastIndex;
  }
  if (source.slice(consumed).trim() !== '')
    throw new Error('attestation-args has an unmatched quote.');
  return args;
}

function label(parts) {
  return parts.map((part) => display(part)).join(' = ');
}

function argsForDiff(left, right) {
  return ['diff', left, right];
}

function check(name, artifact, args, accept) {
  const result = knolo(args);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const code = result.status ?? 1;
  let accepted;
  try {
    accepted = accept({ code, stdout, stderr });
  } catch (error) {
    accepted = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    artifact: String(artifact).includes(' = ')
      ? String(artifact)
      : display(artifact),
    check: name,
    status: accepted.status ?? (accepted.ok ? 'pass' : 'fail'),
    root: accepted.root ?? extractRoot(stdout) ?? '',
    detail:
      accepted.ok || accepted.status === 'changed'
        ? ''
        : clip(accepted.detail || stderr || stdout),
  };
}

function diffAgainstBase(file, ref) {
  if (!/^[\w./-]+$/.test(ref) || ref.startsWith('-')) {
    return failed(
      file,
      'pack diff',
      new Error(
        'diff-base must be a git ref made of letters, numbers, dots, slashes, underscores, or hyphens.'
      )
    );
  }
  const relative = path.relative(workspace, path.resolve(workspace, file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return failed(
      file,
      'pack diff',
      new Error('diff-base only diffs packs inside the workspace.')
    );
  }
  if (!gitCommitExists(ref)) {
    return failed(
      file,
      'pack diff',
      new Error(`diff-base ${ref} is not a commit in this checkout.`)
    );
  }
  const spec = `${ref}:${relative.split(path.sep).join('/')}`;
  if (!gitObjectExists(spec)) {
    return diffChange(file, 'Pack is not present at diff-base.');
  }
  const shown = spawnSync('git', ['show', spec], {
    cwd: workspace,
    encoding: 'buffer',
  });
  if (shown.status !== 0) {
    return failed(file, 'pack diff', new Error('diff-base could not be read.'));
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'knolo-verify-'));
  const baseFile = path.join(dir, 'base.knolo');
  writeFileSync(baseFile, shown.stdout);
  return check(
    'pack diff',
    file,
    ['diff', baseFile, path.resolve(workspace, file)],
    acceptPackDiff
  );
}

function acceptPack({ code, stdout }) {
  if (code !== 0) return { ok: false };
  const json = parseJson(stdout, 'pack verify output was not JSON');
  if (json.verified !== true)
    return { ok: false, detail: 'verified is not true', root: rootOf(json) };
  return { ok: true, root: rootOf(json) };
}

function acceptHealth({ code, stdout }) {
  if (code !== 0) return { ok: false };
  const json = parseJson(stdout, 'v5 health output was not JSON');
  if (json.healthy !== true)
    return { ok: false, detail: 'healthy is not true', root: rootOf(json) };
  return { ok: true, root: rootOf(json) };
}

function acceptMarked(marker) {
  return ({ code, stdout }) => {
    if (code !== 0) return { ok: false };
    if (!stdout.includes(marker))
      return { ok: false, detail: `missing ${marker}` };
    return { ok: true };
  };
}

function acceptExact(markers) {
  return ({ code, stdout }) => {
    if (code !== 0) return { ok: false };
    const text = stdout.trim();
    if (!markers.includes(text))
      return { ok: false, detail: text || 'unexpected verify output' };
    return { ok: true };
  };
}

function acceptCortex({ code, stdout }) {
  if (code !== 0) return { ok: false };
  const match = stdout.match(/^ok\s+(\S+)/m);
  if (!match) return { ok: false, detail: 'cortex verify did not report ok' };
  return { ok: true, root: match[1] };
}

function acceptPackDiff({ code, stdout }) {
  if (code !== 0) return { ok: false };
  const json = parseJson(stdout, 'pack diff output was not JSON');
  const root = typeof json.a?.packDigest === 'string' ? json.a.packDigest : '';
  if (json.equal === true) return { ok: true, root };
  return diffDecision('diff reported changes', root);
}

function acceptGraphDiff({ code, stdout }) {
  if (code !== 0) return { ok: false };
  const before = stdout.match(/old SemanticRoot\s+(\S+)/);
  const after = stdout.match(/new SemanticRoot\s+(\S+)/);
  const root = before?.[1] ?? '';
  const counts = [
    ...stdout.matchAll(
      /(?:nodes|relations|bindings) (?:added|removed)\s+(\d+)/g
    ),
  ];
  const changed =
    (before && after && before[1] !== after[1]) ||
    counts.some((match) => Number(match[1]) > 0);
  if (!changed) return { ok: true, root };
  return diffDecision('graph diff reported changes', root);
}

function diffDecision(detail, root) {
  if (!failOnDiff) return { ok: true, status: 'changed', root, detail: '' };
  return { ok: false, detail, root };
}

function diffChange(file, detail) {
  if (!failOnDiff) {
    return {
      artifact: display(file),
      check: 'pack diff',
      status: 'changed',
      root: '',
      detail: '',
    };
  }
  return {
    artifact: display(file),
    check: 'pack diff',
    status: 'fail',
    root: '',
    detail,
  };
}

function gitCommitExists(ref) {
  const result = spawnSync(
    'git',
    ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    { cwd: workspace, encoding: 'utf8' }
  );
  return result.status === 0;
}

function gitObjectExists(spec) {
  const result = spawnSync('git', ['cat-file', '-e', spec], {
    cwd: workspace,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function knolo(args) {
  // The test harness opts in. A workflow KNOLO_BIN must not replace the CLI
  // installed for cli-version.
  const bin =
    process.env.KNOLO_VERIFY_TEST_BIN === '1' && process.env.KNOLO_BIN
      ? process.env.KNOLO_BIN
      : 'knolo';
  const script = bin.endsWith('.mjs') || bin.endsWith('.js');
  return spawnSync(
    script ? process.execPath : bin,
    script ? [bin, ...args] : args,
    {
      cwd: workspace,
      encoding: 'utf8',
    }
  );
}

function parseJson(stdout, detail) {
  try {
    const json = JSON.parse(stdout);
    if (!json || typeof json !== 'object' || Array.isArray(json))
      throw new Error('object required');
    return json;
  } catch {
    throw new Error(detail);
  }
}

function rootOf(json) {
  for (const key of [
    'stateRoot',
    'semanticRoot',
    'compositionRoot',
    'attestationRoot',
    'traceRoot',
    'commitDigest',
  ]) {
    if (typeof json[key] === 'string') return json[key];
  }
  return '';
}

function extractRoot(stdout) {
  const text = stdout.trim();
  if (text.startsWith('{')) {
    try {
      return rootOf(JSON.parse(text));
    } catch {
      return '';
    }
  }
  const labeled = text.match(
    /(?:Semantic root|SemanticRoot|stateRoot|traceRoot)\s+(\S+)/
  );
  if (labeled) return labeled[1];
  const digest = text.match(/sha256-[a-f0-9]{64}/);
  return digest ? digest[0] : '';
}

function failed(artifact, checkName, error) {
  return {
    artifact: display(artifact),
    check: checkName,
    status: 'fail',
    root: '',
    detail: clip(error instanceof Error ? error.message : String(error)),
  };
}

function display(file) {
  const absolute = path.resolve(workspace, String(file));
  const relative = path.relative(workspace, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    return String(file);
  return relative.split(path.sep).join('/');
}

function clip(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function writeResults(items) {
  const dir = mkdtempSync(
    path.join(process.env.RUNNER_TEMP || tmpdir(), 'knolo-verify-')
  );
  const file = path.join(dir, 'results.json');
  writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`);
  return file;
}

function writeSummary(items) {
  if (!wantSummary || !process.env.GITHUB_STEP_SUMMARY) return;
  const linesOut = [
    '### Knolo verify',
    '',
    '| Artifact | Check | Result | stateRoot / root |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of items) {
    linesOut.push(
      `| ${cell(row.artifact)} | ${cell(row.check)} | ${cell(row.status)} | ${cell(row.root)} |`
    );
  }
  linesOut.push('');
  linesOut.push(
    'Verification checks integrity against declared evidence. It does not mean a claim is true. A KAR status of SATISFIED means evidence requirements were met. It does not mean a claim is proven.'
  );
  linesOut.push('');
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${linesOut.join('\n')}\n`, {
    flag: 'a',
  });
}

function cell(value) {
  return `\`${String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")}\``;
}

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  if (/[\r\n]/.test(value)) throw new Error(`output ${name} must be one line`);
  writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}
