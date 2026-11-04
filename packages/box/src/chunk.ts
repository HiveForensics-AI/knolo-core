import { WINDOW_LINES } from './limits.js';

export type TextSlice = {
  startLine: number;
  endLine: number;
  text: string;
};

export function sliceText(text: string, markdown: boolean): TextSlice[] {
  const lines = text.split(/\r?\n/u);
  const breaks = [0];
  if (markdown) {
    for (let index = 1; index < lines.length; index += 1) {
      if (/^#{1,6}\s+\S/u.test(lines[index] ?? '')) breaks.push(index);
    }
  }
  const slices: TextSlice[] = [];
  for (let index = 0; index < breaks.length; index += 1) {
    const start = breaks[index] ?? 0;
    const end = breaks[index + 1] ?? lines.length;
    for (let window = start; window < end; window += WINDOW_LINES) {
      const windowEnd = Math.min(window + WINDOW_LINES, end);
      const body = lines.slice(window, windowEnd).join('\n').trim();
      if (!body) continue;
      slices.push({
        startLine: window + 1,
        endLine: windowEnd,
        text: body,
      });
    }
  }
  return slices;
}

export function citationHeader(input: {
  source: string;
  locator: string;
  when?: string;
  agent?: string;
  body: string;
}): string {
  const lines = [`source: ${input.source}`, `locator: ${input.locator}`];
  if (input.when) lines.push(`when: ${input.when}`);
  if (input.agent) lines.push(`agent: ${input.agent}`);
  return `${lines.join('\n')}\n\n${input.body}`;
}
