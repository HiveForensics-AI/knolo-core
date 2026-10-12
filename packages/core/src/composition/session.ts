import { createKarSession, evaluateKar } from '../experimental/kar/session.js';
import { KarError, type KarEvaluation } from '../experimental/kar/types.js';
import type { KnowledgePolicyV1, Digest } from '../knowledge_image_v5.js';
import { evaluateKnowledgeQueryPolicyV5 } from '../knowledge_policy_v5.js';
import { queryKnowledgeImageV5, type KnowledgeQueryHitV1 } from '../knowledge_query_v5.js';
import { mountPackFromBuffer } from '../pack.runtime.js';
import { query, type Hit } from '../query.js';
import { getTextDecoder } from '../utils/utf8.js';
import { copyBuffer } from './codec.js';
import { CompositionError } from './errors.js';
import {
  parseCompositionRecord,
  verifyCompositionRecord,
  type Availability,
  type CompositionHost,
  type CompositionRecord,
  type CompositionVerifyOptions,
  type KarBinding,
  type MemberKind,
  type MemberMaterial,
} from './record.js';

export type ComposedMemberView = {
  alias: string;
  kind: MemberKind;
  status: 'material' | 'digest-bound';
};

export type ComposedSession = {
  compositionRoot: Digest;
  host: CompositionHost;
  hostBytes?: Uint8Array;
  availability: Availability;
  record: CompositionRecord;
  members: ComposedMemberView[];
  material: Record<string, MemberMaterial>;
};

export type ComposedQueryMemberResult = {
  alias: string;
  kind: MemberKind;
  status: 'queried' | 'not-queryable';
  planRoot?: Digest;
  resultRoot?: Digest;
  hits?: KnowledgeQueryHitV1[] | Hit[];
  authorizationRoot?: Digest;
};

export type ComposedQueryResult = {
  compositionRoot: Digest;
  results: ComposedQueryMemberResult[];
};

export type ComposedQueryInput = {
  eql?: string;
  question?: string;
  principal?: string;
  policy?: KnowledgePolicyV1;
  requirePolicy?: boolean;
  requireQueryable?: boolean;
};

export function karCompositionBinder(image: Uint8Array, graph: Uint8Array): KarBinding {
  const session = createKarSession({ image, graph: parseGraph(graph, 'graph') });
  const roots = session.roots;
  if (!roots.stateRoot || !roots.objectRoot || !roots.commitDigest) {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', 'KAR session is missing V5 image roots.', 'graph');
  }
  return {
    knowledgeRoot: roots.knowledgeRoot as Digest,
    semanticRoot: roots.semanticRoot as Digest,
    stateRoot: roots.stateRoot as Digest,
    objectRoot: roots.objectRoot as Digest,
    commitDigest: roots.commitDigest as Digest,
  };
}

export function openComposedSession(record: unknown, material: CompositionVerifyOptions = {}): ComposedSession {
  const verified = verifyCompositionRecord(record, material);
  if (!verified.ok) {
    throw new CompositionError(verified.code, `Composition did not verify: ${verified.code}.`, verified.path);
  }
  const parsed = parseCompositionRecord(record);
  const statusByAlias = new Map(verified.members.map((member) => [member.alias, member.status]));
  return {
    compositionRoot: parsed.compositionRoot,
    host: parsed.host,
    ...(material.hostBytes ? { hostBytes: material.hostBytes } : {}),
    availability: parsed.availability,
    record: parsed,
    members: parsed.members.map((member) => ({
      alias: member.alias,
      kind: member.kind,
      status: statusByAlias.get(member.alias) ?? 'digest-bound',
    })),
    material: material.members ?? {},
  };
}

export function queryComposedSession(session: ComposedSession, input: ComposedQueryInput): ComposedQueryResult {
  const eql = typeof input.eql === 'string' && input.eql.length > 0 ? input.eql : undefined;
  const question = typeof input.question === 'string' && input.question.length > 0 ? input.question : undefined;
  if (!eql && !question) {
    throw new CompositionError('COMPOSITION_INVALID', 'A composed query needs eql or question.', 'query');
  }
  const results: ComposedQueryMemberResult[] = [];
  for (const member of session.record.members) {
    results.push(queryMember(session, member.alias, member.kind, eql, question, input));
  }
  return { compositionRoot: session.compositionRoot, results };
}

export function evaluateComposedKar(
  session: ComposedSession,
  input: { alias: string; proposition: string; plan: unknown },
): { compositionRoot: Digest; alias: string; evaluation: KarEvaluation } {
  const member = session.record.members.find((item) => item.alias === input.alias);
  if (!member || member.kind !== 'kar-sidecar') {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', 'Alias is not a KAR sidecar.', input.alias);
  }
  const graphBytes = bytesOf(session.material[member.alias]);
  if (!graphBytes) throw new CompositionError('COMPOSITION_MEMBER_MISSING', 'KAR sidecar bytes are missing.', member.alias);
  const imageBytes = member.bindsTo === 'host' ? session.hostBytes : bytesOf(session.material[member.bindsTo]);
  if (!imageBytes) throw new CompositionError('COMPOSITION_KAR_UNBOUND', 'KAR image bytes are missing.', member.alias);
  try {
    const kar = createKarSession({ image: imageBytes, graph: parseGraph(graphBytes, member.alias) });
    const evaluation = evaluateKar(kar, { proposition: input.proposition, plan: input.plan });
    return { compositionRoot: session.compositionRoot, alias: member.alias, evaluation };
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    if (error instanceof KarError) throw new CompositionError('COMPOSITION_KAR_UNBOUND', error.message, member.alias, error);
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', error instanceof Error ? error.message : String(error), member.alias, error);
  }
}

function queryMember(
  session: ComposedSession,
  alias: string,
  kind: MemberKind,
  eql: string | undefined,
  question: string | undefined,
  input: ComposedQueryInput,
): ComposedQueryMemberResult {
  const bytes = bytesOf(session.material[alias]);
  if (kind === 'v5-image' && eql && bytes) return queryImage(alias, bytes, eql, input);
  if (kind === 'v4-pack' && question && bytes) return queryPack(alias, bytes, question);
  if (input.requireQueryable) {
    throw new CompositionError('COMPOSITION_NOT_QUERYABLE', `${alias} cannot answer this query.`, alias);
  }
  return { alias, kind, status: 'not-queryable' };
}

function queryImage(alias: string, bytes: Uint8Array, eql: string, input: ComposedQueryInput): ComposedQueryMemberResult {
  try {
    const result = queryKnowledgeImageV5(bytes, eql);
    const row: ComposedQueryMemberResult = {
      alias,
      kind: 'v5-image',
      status: 'queried',
      planRoot: result.planRoot,
      resultRoot: result.resultRoot,
      hits: result.hits,
    };
    if (input.requirePolicy) {
      if (!input.policy || !input.principal) {
        throw new CompositionError('COMPOSITION_POLICY_INVALID', 'requirePolicy needs a policy and a principal.', alias);
      }
      const authorization = evaluateKnowledgeQueryPolicyV5(bytes, result, input.policy, input.principal, 'query');
      if (authorization.decision !== 'allow') {
        throw new CompositionError('COMPOSITION_POLICY_DENIED', `Policy decision for ${alias} is ${authorization.decision}.`, alias);
      }
      row.authorizationRoot = authorization.authorizationRoot;
    }
    return row;
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('policy root')) {
      throw new CompositionError('COMPOSITION_POLICY_INVALID', message, alias, error);
    }
    throw new CompositionError('COMPOSITION_INVALID', message, alias, error);
  }
}

function queryPack(alias: string, bytes: Uint8Array, question: string): ComposedQueryMemberResult {
  try {
    const pack = mountPackFromBuffer(copyBuffer(bytes));
    const hits = query(pack, question);
    return { alias, kind: 'v4-pack', status: 'queried', hits };
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    throw new CompositionError('COMPOSITION_INVALID', error instanceof Error ? error.message : String(error), alias, error);
  }
}

function bytesOf(material: MemberMaterial | undefined): Uint8Array | undefined {
  if (!material || !('bytes' in material)) return undefined;
  return material.bytes;
}

function parseGraph(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(getTextDecoder().decode(bytes));
  } catch (error) {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', 'KAR sidecar is not JSON.', path, error);
  }
}
