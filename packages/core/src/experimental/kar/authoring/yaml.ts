import type { CegLimits } from './constants.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';

export type YamlParse =
  | { ok: true; value: unknown }
  | { ok: false; diagnostics: CegDiagnostic[] };

type Line = { indent: number; text: string; number: number };

/**
 * Block-YAML subset for CEG Source.
 * Flow collections, anchors, and tabs are rejected.
 * JSON remains available for the same object model.
 */
export function parseYamlSubset(text: string, limits: CegLimits): YamlParse {
  if (text.length > limits.maxSourceBytes) {
    return fail('CEG_LIMIT_EXCEEDED', '', `Source exceeds ${limits.maxSourceBytes} bytes.`);
  }
  if (text.includes('\0')) return fail('CEG_PARSE', '', 'Source contains a NUL byte.');
  const raw = text.split(/\r\n|\n|\r/);
  if (raw.length > limits.maxLines) {
    return fail('CEG_LIMIT_EXCEEDED', '', `Source exceeds ${limits.maxLines} lines.`);
  }
  const lines: Line[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index] ?? '';
    if (line.includes('\t')) {
      return fail('CEG_YAML_TAB', String(index + 1), 'Tabs are not allowed in CEG YAML. Use spaces.');
    }
    const stripped = stripComment(line);
    if (stripped.trim().length === 0) continue;
    const indent = leadingSpaces(stripped);
    lines.push({ indent, text: stripped.slice(indent).trimEnd(), number: index + 1 });
  }
  if (lines.length === 0) return fail('CEG_PARSE', '', 'CEG source is empty.');
  try {
    const parsed = parseNode(lines, 0, limits, 0);
    if (parsed.index !== lines.length) {
      const extra = lines[parsed.index];
      return fail('CEG_PARSE', String(extra?.number ?? ''), 'Unexpected trailing YAML content.');
    }
    return { ok: true, value: parsed.value };
  } catch (error) {
    if (error instanceof YamlError) return { ok: false, diagnostics: [error.diagnostic] };
    throw error;
  }
}

class YamlError extends Error {
  readonly diagnostic: CegDiagnostic;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.diagnostic = diagnostic('error', code, path, message);
  }
}

function parseNode(
  lines: Line[],
  index: number,
  limits: CegLimits,
  depth: number,
): { value: unknown; index: number } {
  if (depth > limits.maxDepth) {
    throw new YamlError('CEG_LIMIT_EXCEEDED', String(lines[index]?.number ?? ''), 'YAML nesting is too deep.');
  }
  const line = lines[index];
  if (!line) throw new YamlError('CEG_PARSE', '', 'Expected a YAML value.');
  if (line.text === '-' || line.text.startsWith('- ')) return parseSequence(lines, index, limits, depth);
  return parseMap(lines, index, limits, depth);
}

function parseMap(
  lines: Line[],
  index: number,
  limits: CegLimits,
  depth: number,
): { value: Record<string, unknown>; index: number } {
  const indent = lines[index]?.indent ?? 0;
  const map: Record<string, unknown> = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlError('CEG_PARSE', String(line.number), 'YAML indentation does not match an open map.');
    }
    if (line.text.startsWith('- ') || line.text === '-') break;
    const split = splitKey(line.text, line.number);
    if (Object.prototype.hasOwnProperty.call(map, split.key)) {
      throw new YamlError('CEG_DUPLICATE_KEY', `${line.number}`, `Duplicate YAML key "${split.key}".`);
    }
    if (split.rest === undefined) {
      const next = lines[cursor + 1];
      if (!next || next.indent <= indent) {
        map[split.key] = null;
        cursor += 1;
        continue;
      }
      const nested = parseNode(lines, cursor + 1, limits, depth + 1);
      map[split.key] = nested.value;
      cursor = nested.index;
      continue;
    }
    map[split.key] = parseScalar(split.rest, line.number);
    cursor += 1;
  }
  return { value: map, index: cursor };
}

function parseSequence(
  lines: Line[],
  index: number,
  limits: CegLimits,
  depth: number,
): { value: unknown[]; index: number } {
  const indent = lines[index]?.indent ?? 0;
  const items: unknown[] = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlError('CEG_PARSE', String(line.number), 'YAML indentation does not match an open list.');
    }
    if (!(line.text === '-' || line.text.startsWith('- '))) break;
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    if (rest.length === 0) {
      const next = lines[cursor + 1];
      if (!next || next.indent <= indent) {
        items.push(null);
        cursor += 1;
        continue;
      }
      const nested = parseNode(lines, cursor + 1, limits, depth + 1);
      items.push(nested.value);
      cursor = nested.index;
      continue;
    }
    if (isKeyLine(rest)) {
      const inline = splitKey(rest, line.number);
      const item: Record<string, unknown> = {};
      const itemIndent = indent + 2;
      if (inline.rest === undefined) {
        const next = lines[cursor + 1];
        if (next && next.indent > itemIndent - 1 && next.indent > indent) {
          const nested = parseNode(lines, cursor + 1, limits, depth + 1);
          item[inline.key] = nested.value;
          cursor = nested.index;
        } else {
          item[inline.key] = null;
          cursor += 1;
        }
      } else {
        item[inline.key] = parseScalar(inline.rest, line.number);
        cursor += 1;
      }
      while (cursor < lines.length) {
        const follow = lines[cursor];
        if (!follow || follow.indent < itemIndent) break;
        if (follow.text.startsWith('- ') || follow.text === '-') break;
        if (follow.indent > itemIndent) {
          throw new YamlError('CEG_PARSE', String(follow.number), 'YAML indentation does not match a list item.');
        }
        const field = splitKey(follow.text, follow.number);
        if (Object.prototype.hasOwnProperty.call(item, field.key)) {
          throw new YamlError('CEG_DUPLICATE_KEY', String(follow.number), `Duplicate YAML key "${field.key}".`);
        }
        if (field.rest === undefined) {
          const next = lines[cursor + 1];
          if (!next || next.indent <= follow.indent) {
            item[field.key] = null;
            cursor += 1;
            continue;
          }
          const nested = parseNode(lines, cursor + 1, limits, depth + 1);
          item[field.key] = nested.value;
          cursor = nested.index;
          continue;
        }
        item[field.key] = parseScalar(field.rest, follow.number);
        cursor += 1;
      }
      items.push(item);
      continue;
    }
    items.push(parseScalar(rest, line.number));
    cursor += 1;
  }
  return { value: items, index: cursor };
}

function splitKey(text: string, line: number): { key: string; rest: string | undefined } {
  if (text.startsWith('-') || text.startsWith('{') || text.startsWith('[')) {
    throw new YamlError('CEG_YAML_UNSUPPORTED', String(line), 'Flow YAML and nested dashes in keys are not accepted.');
  }
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':') {
      const key = text.slice(0, index).trim();
      const after = text.slice(index + 1);
      if (key.length === 0) throw new YamlError('CEG_PARSE', String(line), 'YAML key is empty.');
      if (after.length === 0) return { key: unquoteKey(key, line), rest: undefined };
      if (!after.startsWith(' ')) throw new YamlError('CEG_PARSE', String(line), 'YAML keys require ": " before a value.');
      return { key: unquoteKey(key, line), rest: after.trim() };
    }
  }
  throw new YamlError('CEG_PARSE', String(line), 'Expected a YAML key.');
}

function unquoteKey(key: string, line: number): string {
  if (key.startsWith('"') || key.startsWith("'")) {
    const value = parseScalar(key, line);
    if (typeof value !== 'string' || value.length === 0) {
      throw new YamlError('CEG_PARSE', String(line), 'YAML key is empty.');
    }
    return value;
  }
  if (key.includes('#')) throw new YamlError('CEG_PARSE', String(line), 'Unquoted YAML key contains "#".');
  return key;
}

function isKeyLine(text: string): boolean {
  if (text.startsWith('"') || text.startsWith("'")) return false;
  const colon = text.indexOf(':');
  return colon > 0 && (text.length === colon + 1 || text[colon + 1] === ' ');
}

function parseScalar(text: string, line: number): unknown {
  if (text.startsWith('{') || text.startsWith('[')) {
    throw new YamlError('CEG_YAML_UNSUPPORTED', String(line), 'Flow YAML collections are not accepted. Use block YAML or JSON.');
  }
  if (text.startsWith('|') || text.startsWith('>')) {
    throw new YamlError('CEG_YAML_UNSUPPORTED', String(line), 'Multiline YAML scalars are not accepted.');
  }
  if (text.startsWith('"')) return parseDouble(text, line);
  if (text.startsWith("'")) return parseSingle(text, line);
  if (text === 'null' || text === '~' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  if (/^-?(0|[1-9][0-9]*)$/.test(text)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
      throw new YamlError('CEG_LIMIT_EXCEEDED', String(line), 'Integer is outside the safe integer range.');
    }
    return value;
  }
  return text;
}

function parseDouble(text: string, line: number): string {
  if (!text.endsWith('"') || text.length < 2) {
    throw new YamlError('CEG_PARSE', String(line), 'Unclosed double quote.');
  }
  let out = '';
  for (let index = 1; index < text.length - 1; index += 1) {
    const ch = text[index];
    if (ch === '\\') {
      const next = text[index + 1];
      if (next === '"' || next === '\\' || next === '/') out += next;
      else if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else throw new YamlError('CEG_PARSE', String(line), 'Unsupported string escape.');
      index += 1;
      continue;
    }
    out += ch ?? '';
  }
  return out;
}

function parseSingle(text: string, line: number): string {
  if (!text.endsWith("'") || text.length < 2) {
    throw new YamlError('CEG_PARSE', String(line), 'Unclosed single quote.');
  }
  const body = text.slice(1, -1);
  if (body.includes("'") && !body.includes("''")) {
    throw new YamlError('CEG_PARSE', String(line), 'Unescaped single quote.');
  }
  return body.replaceAll("''", "'");
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, index);
  }
  return line;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === ' ') count += 1;
  return count;
}

function fail(code: string, path: string, message: string): YamlParse {
  return { ok: false, diagnostics: [diagnostic('error', code, path, message)] };
}
