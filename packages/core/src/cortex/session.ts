import { digest } from '../experimental/kar/canonicalize.js';
import { createKarSession, type KarSession } from '../experimental/kar/session.js';
import { KarError } from '../experimental/kar/types.js';
import { CortexError } from './errors.js';
import { resolveCortexPolicy } from './policy.js';
import { mountCortexImage, type CortexMounted, type CortexRetriever } from './retrieve.js';
import type { CortexImageIdentity, CortexMode, CortexPolicyV1 } from './types.js';

export type CortexModelAdapter = {
  planQuestion?: (input: { question: string; mode: CortexMode }) => CortexPlanOutput | Promise<CortexPlanOutput>;
  selectEvidence?: (input: CortexSelectInput) => CortexSelectOutput | Promise<CortexSelectOutput>;
  refineQuery?: (input: CortexRefineInput) => CortexRefineOutput | Promise<CortexRefineOutput>;
  synthesizeAnswer?: (input: CortexSynthesizeInput) => CortexSynthesizeOutput | Promise<CortexSynthesizeOutput>;
};

export type CortexPlanOutput = { subquestions: string[] };
export type CortexSelectInput = {
  question: string;
  round: number;
  query: string;
  hits: Array<{ id: string; score: number; excerpt: string; source?: string }>;
};
export type CortexSelectOutput = {
  selectedIds: string[];
  rejected?: Array<{ id: string; reason: string }>;
  reason: string;
};
export type CortexRefineInput = {
  question: string;
  gaps: Array<{ subquestion: string; reason: string }>;
  previousQueries: string[];
};
export type CortexRefineOutput = { query: string; reason: string };
export type CortexSynthesizeInput = {
  question: string;
  mode: CortexMode;
  evidence: Array<{ id: string; excerpt: string; source?: string }>;
};
export type CortexSynthesizeOutput = {
  text: string;
  claims?: Array<{ text: string; evidenceIds: string[] }>;
  citations?: Array<{ evidenceId: string }>;
  gaps?: Array<{ subquestion: string; reason: string }>;
};

export type CortexSession = {
  readonly image: CortexImageIdentity;
  readonly policy: CortexPolicyV1;
  readonly mounted: CortexMounted;
  readonly kar?: KarSession;
  readonly plan?: unknown;
  readonly planDigest?: string;
  readonly model?: CortexModelAdapter;
  readonly retriever?: CortexRetriever;
};

export async function createCortexSession(input: {
  image: Uint8Array | ArrayBuffer;
  graph?: unknown;
  retriever?: CortexRetriever;
  model?: CortexModelAdapter;
  policy?: Partial<CortexPolicyV1>;
  plan?: unknown;
}): Promise<CortexSession> {
  const policy = resolveCortexPolicy(input.policy);
  const mounted = mountCortexImage(input.image);
  const image: CortexImageIdentity = { ...mounted.image };
  let kar: KarSession | undefined;
  if (input.graph !== undefined) {
    try {
      kar = createKarSession({ image: mounted.bytes, graph: parseGraph(input.graph) });
    } catch (error) {
      if (error instanceof CortexError) throw error;
      const message = error instanceof KarError || error instanceof Error ? error.message : 'KAR graph is not bound to this image.';
      throw new CortexError('CORTEX_KAR_UNBOUND', message, 'graph', error);
    }
    image.knowledgeRoot = kar.roots.knowledgeRoot;
  }
  return {
    image,
    policy,
    mounted: { ...mounted, image },
    ...(kar ? { kar } : {}),
    ...(input.plan !== undefined ? { plan: input.plan, planDigest: digest(input.plan) } : {}),
    model: input.model,
    retriever: input.retriever,
  };
}

function parseGraph(graph: unknown): unknown {
  if (typeof graph === 'string') return JSON.parse(graph) as unknown;
  if (graph instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(graph)) as unknown;
  return graph;
}
