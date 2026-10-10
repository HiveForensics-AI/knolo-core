/**
 * Experimental local model adapter.
 * It returns proposal JSON. It does not validate, repair, or compile that JSON.
 * The caller passes the JSON to validateModelProposals in @knolo/core authoring.
 */

export type OllamaCegProposalRequest = {
  evidence: Array<{ id: string; text: string }>;
  schema: unknown;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export async function proposeCegWithOllama(input: OllamaCegProposalRequest): Promise<{ output: unknown; prompt: string }> {
  const endpoint = (input.endpoint ?? 'http://127.0.0.1:11434').replace(/\/$/u, '');
  const model = input.model ?? 'qwen3:4b';
  const prompt = [
    'Return one JSON object. format must be ceg-model-proposals-1.',
    'Keys are format, model, concepts, relations, bindings, and aliases.',
    'Every relation and binding must include evidenceId and a quote copied from that evidence.',
    'Do not invent dates, authority, or missing referents.',
    'Do not wrap the JSON in markdown.',
    'Domain schema:',
    JSON.stringify(input.schema),
    'Evidence:',
    JSON.stringify(input.evidence),
  ].join('\n');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error('CEG_PRODUCER_OUTPUT_INVALID');
  const body = await response.json() as { message?: { content?: unknown } };
  const content = body.message?.content;
  if (typeof content !== 'string') throw new Error('CEG_PRODUCER_OUTPUT_INVALID');
  try {
    return { output: JSON.parse(content), prompt };
  } catch {
    throw new Error('CEG_PRODUCER_OUTPUT_INVALID');
  }
}
