import { resolveLimits, type CegLimits } from './constants.js';
import { parseJsonText } from './json.js';
import { interpretCegSource, type InterpretedSource } from './model.js';
import { parseYamlSubset } from './yaml.js';

export function parseCegSource(text: string, limits?: Partial<CegLimits>): InterpretedSource {
  const parsed = parseAuthoringDocument(text, limits);
  if (!parsed.ok) return parsed;
  return interpretCegSource(parsed.value, resolveLimits(limits));
}

/** JSON or block YAML, without interpreting the value as CEG Source. */
export function parseAuthoringDocument(text: string, limits?: Partial<CegLimits>) {
  const resolved = resolveLimits(limits);
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[')
    ? parseJsonText(text, resolved)
    : parseYamlSubset(text, resolved);
}
