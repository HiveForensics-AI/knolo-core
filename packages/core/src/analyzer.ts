import { getTextEncoder } from './utils/utf8.js';
import { sha256Hex } from './utils/sha256.js';

export type AnalyzerProfile = {
  id: 'knolo-analyzer/en-technical-v1' | 'knolo-analyzer/code-typescript-v1' | 'knolo-analyzer/multilingual-general-v1';
  version: 1;
  unicode: 'nfkd-diacritic-fold';
  identifier: 'split-punctuation-preserve-hyphen';
  exactToken: boolean;
  pathTokens: boolean;
};

export const ANALYZER_PROFILES: Record<AnalyzerProfile['id'], AnalyzerProfile> = {
  'knolo-analyzer/en-technical-v1': { id: 'knolo-analyzer/en-technical-v1', version: 1, unicode: 'nfkd-diacritic-fold', identifier: 'split-punctuation-preserve-hyphen', exactToken: true, pathTokens: true },
  'knolo-analyzer/code-typescript-v1': { id: 'knolo-analyzer/code-typescript-v1', version: 1, unicode: 'nfkd-diacritic-fold', identifier: 'split-punctuation-preserve-hyphen', exactToken: true, pathTokens: true },
  'knolo-analyzer/multilingual-general-v1': { id: 'knolo-analyzer/multilingual-general-v1', version: 1, unicode: 'nfkd-diacritic-fold', identifier: 'split-punctuation-preserve-hyphen', exactToken: true, pathTokens: true },
};

export function resolveAnalyzerProfile(id?: AnalyzerProfile['id']): AnalyzerProfile {
  return ANALYZER_PROFILES[id ?? 'knolo-analyzer/en-technical-v1'];
}

export function analyzerProfileDigest(profile: AnalyzerProfile): string {
  return `sha256-${sha256Hex(getTextEncoder().encode(JSON.stringify(profile)))}`;
}
