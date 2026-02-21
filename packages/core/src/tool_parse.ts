import { isToolCallV1, type ToolCallV1 } from './tools.js';

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function findBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseToolCallCandidate(candidate: string): ToolCallV1 | null {
  const value = tryParseJson(candidate);
  return isToolCallV1(value) ? value : null;
}

function parseFromFencedBlock(text: string): ToolCallV1 | null {
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(text)) !== null) {
    const parsed = parseToolCallCandidate(match[1].trim());
    if (parsed) return parsed;
  }
  return null;
}

function parseFromMarkerLine(text: string): ToolCallV1 | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const markerIndex = line.indexOf('TOOL_CALL:');
    if (markerIndex === -1) continue;
    const tail = line.slice(markerIndex + 'TOOL_CALL:'.length).trim();
    if (!tail) continue;

    const objectText = findBalancedJsonObject(tail) ?? tail;
    const parsed = parseToolCallCandidate(objectText);
    if (parsed) return parsed;
  }
  return null;
}

function parseFirstJsonObject(text: string): unknown | null {
  const objectText = findBalancedJsonObject(text);
  if (!objectText) return null;
  return tryParseJson(objectText);
}

export function parseToolCallV1FromText(text: string): ToolCallV1 | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const whole = parseToolCallCandidate(text.trim());
  if (whole) return whole;

  const fenced = parseFromFencedBlock(text);
  if (fenced) return fenced;

  const marker = parseFromMarkerLine(text);
  if (marker) return marker;

  const firstObject = parseFirstJsonObject(text);
  return isToolCallV1(firstObject) ? firstObject : null;
}
