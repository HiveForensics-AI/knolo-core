export const KNOWLEDGE_CATEGORIES = [
  'coding',
  'math',
  'science',
  'news',
  'business',
  'security',
  'writing',
  'general',
];

const IDS = new Set(KNOWLEDGE_CATEGORIES);

export function normalizeCategories(values, { min = 1, max = KNOWLEDGE_CATEGORIES.length } = {}) {
  if (values == null) return null;
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) {
    throw new Error(`Choose ${min} to ${max} categories.`);
  }
  const seen = [];
  for (const value of list) {
    if (typeof value !== 'string' || !IDS.has(value)) {
      throw new Error(`--category must be one of ${KNOWLEDGE_CATEGORIES.join(', ')}.`);
    }
    if (!seen.includes(value)) seen.push(value);
  }
  if (seen.length < min || seen.length > max) {
    throw new Error(`Choose ${min} to ${max} categories.`);
  }
  return seen;
}
