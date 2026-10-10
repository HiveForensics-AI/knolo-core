import type { CegLimits } from './constants.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';

export type JsonParse =
  | { ok: true; value: unknown }
  | { ok: false; diagnostics: CegDiagnostic[] };

/** JSON.parse plus a linear duplicate-key rejection. Objects keep fail-closed authoring. */
export function parseJsonText(text: string, limits: CegLimits): JsonParse {
  if (text.length > limits.maxSourceBytes) {
    return fail('CEG_LIMIT_EXCEEDED', '', `Source exceeds ${limits.maxSourceBytes} bytes.`);
  }
  const duplicate = findDuplicateKey(text, limits);
  if (duplicate) return { ok: false, diagnostics: [duplicate] };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON parse failed.';
    return fail('CEG_PARSE', '', message);
  }
}

function findDuplicateKey(text: string, limits: CegLimits): CegDiagnostic | null {
  const stack: Array<Map<string, true> | null> = [];
  let depth = 0;
  let index = 0;
  let expectKey = false;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"') {
      const read = readString(text, index);
      if (!read) return diagnostic('error', 'CEG_PARSE', '', 'Unclosed JSON string.');
      if (expectKey && stack.length > 0) {
        const keys = stack[stack.length - 1];
        if (keys) {
          if (keys.has(read.value)) {
            return diagnostic('error', 'CEG_DUPLICATE_KEY', read.value, `Duplicate JSON key "${read.value}".`);
          }
          keys.set(read.value, true);
        }
        expectKey = false;
      }
      index = read.next;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      if (depth > limits.maxDepth) {
        return diagnostic('error', 'CEG_LIMIT_EXCEEDED', '', 'JSON nesting is too deep.');
      }
      stack.push(new Map());
      expectKey = true;
      index += 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      depth -= 1;
      expectKey = false;
      index += 1;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      if (depth > limits.maxDepth) {
        return diagnostic('error', 'CEG_LIMIT_EXCEEDED', '', 'JSON nesting is too deep.');
      }
      stack.push(null);
      expectKey = false;
      index += 1;
      continue;
    }
    if (ch === ']') {
      stack.pop();
      depth -= 1;
      index += 1;
      continue;
    }
    if (ch === ',') {
      const frame = stack[stack.length - 1];
      expectKey = frame instanceof Map;
      index += 1;
      continue;
    }
    if (ch === ':') {
      expectKey = false;
      index += 1;
      continue;
    }
    index += 1;
  }
  return null;
}

function readString(text: string, start: number): { value: string; next: number } | null {
  let value = '';
  for (let index = start + 1; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '\\') {
      const next = text[index + 1];
      if (next === undefined) return null;
      value += next === 'u' ? text.slice(index, index + 6) : next;
      index += next === 'u' ? 5 : 1;
      continue;
    }
    if (ch === '"') return { value, next: index + 1 };
    value += ch;
  }
  return null;
}

function fail(code: string, path: string, message: string): JsonParse {
  return { ok: false, diagnostics: [diagnostic('error', code, path, message)] };
}
