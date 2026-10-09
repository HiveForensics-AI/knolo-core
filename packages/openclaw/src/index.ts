import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  canonicalCbor,
  digestDomain,
  evaluateKnowledgeQueryPolicyV5,
  knowledgePolicyRootV5,
  mountKnowledgeImageV5,
  queryKnowledgeImageV5,
  verifyKnowledgeImageV5,
  verifyKnowledgeQueryResultV5,
  type KnowledgeAuthorizationResultV1,
  type KnowledgeImageV5,
  type KnowledgePolicyV1,
  type KnowledgeQueryResultV1,
} from '@knolo/core';

export const OPENCLAW_KNOLO_RECEIPT_VERSION = 'openclaw-knolo-query-v1';

export type KnoloMountConfig = {
  id: string;
  path: string;
  sha256: string;
  stateRoot: string;
  policyPath: string;
  agents: string[];
  principal: string;
};

export type KnoloPluginConfig = {
  mounts: KnoloMountConfig[];
  maxImageBytes?: number;
  maxHits?: number;
  maxExcerptBytes?: number;
  maxQueryBytes?: number;
  auditDir: string;
};

export type KnoloCaller = {
  agentId: string;
  runId?: string;
  sessionId?: string;
};

export type KnoloSearchRequest = {
  query: string;
  imageIds?: string[];
  limit?: number;
};

export type KnoloSearchHit = {
  imageId: string;
  objectId: string;
  kind: string;
  excerpt: string;
  start: number;
  end: number;
  stateRoot: string;
  planRoot: string;
  resultRoot: string;
  receiptId: string;
};

export type KnoloSearchResult = {
  version: 1;
  hits: KnoloSearchHit[];
  receipts: Array<{
    imageId: string;
    receiptId: string;
    stateRoot: string;
    planRoot: string;
    resultRoot: string;
  }>;
};

export type KnoloGetRequest = {
  imageId: string;
  objectId: string;
  stateRoot: string;
  start?: number;
  end?: number;
};

export type KnoloGetResult = {
  imageId: string;
  objectId: string;
  kind: string;
  content: string;
  start: number;
  end: number;
  stateRoot: string;
};

export type KnoloVerification = {
  imageId: string;
  byteSha256: string;
  stateRoot: string;
  commitDigest: string;
  valid: true;
};

export type KnoloStatus = {
  imageId: string;
  stateRoot: string;
  source: 'local';
  status: 'ready';
};

export type KnoloQueryReceiptV1 = {
  version: typeof OPENCLAW_KNOLO_RECEIPT_VERSION;
  receiptId: string;
  recordDigest: string;
  createdAt: string;
  imageId: string;
  byteSha256: string;
  stateRoot: string;
  caller: KnoloCaller;
  query: string;
  queryResult: KnowledgeQueryResultV1;
  authorization: KnowledgeAuthorizationResultV1;
  returned: Array<{ objectId: string; start: number; end: number }>;
};

export class KnoloPluginError extends Error {
  constructor(
    readonly code:
      | 'ACCESS_DENIED'
      | 'AUDIT_UNAVAILABLE'
      | 'IMAGE_INVALID'
      | 'IMAGE_UNAVAILABLE'
      | 'NOT_FOUND'
      | 'QUERY_INVALID'
      | 'STATE_ROOT_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'KnoloPluginError';
  }
}

type MountSnapshot = {
  config: KnoloMountConfig;
  image: KnowledgeImageV5;
  policy: KnowledgePolicyV1;
  byteSha256: string;
};

type NormalizedConfig = Required<Omit<KnoloPluginConfig, 'mounts'>> & {
  mounts: KnoloMountConfig[];
};

const DEFAULT_MAX_IMAGE_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_HITS = 8;
const DEFAULT_MAX_EXCERPT_BYTES = 1600;
const DEFAULT_MAX_QUERY_BYTES = 4096;
const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_PATTERN = /^sha256-[a-f0-9]{64}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

export class KnoloOpenClawService {
  #config: NormalizedConfig;
  #mounts = new Map<string, MountSnapshot>();

  private constructor(config: NormalizedConfig) {
    this.#config = config;
  }

  static async create(
    config: KnoloPluginConfig
  ): Promise<KnoloOpenClawService> {
    const service = new KnoloOpenClawService(normalizeConfig(config));
    await service.reload();
    return service;
  }

  async reload(config?: KnoloPluginConfig): Promise<void> {
    const nextConfig = config ? normalizeConfig(config) : this.#config;
    const nextMounts = new Map<string, MountSnapshot>();
    for (const mount of nextConfig.mounts) {
      nextMounts.set(
        mount.id,
        await loadMount(mount, nextConfig.maxImageBytes)
      );
    }
    this.#config = nextConfig;
    this.#mounts = nextMounts;
  }

  async search(
    request: KnoloSearchRequest,
    caller: KnoloCaller
  ): Promise<KnoloSearchResult> {
    const query = normalizeQuery(request.query, this.#config.maxQueryBytes);
    const limit = normalizeLimit(request.limit, this.#config.maxHits);
    const mounts = this.selectMounts(request.imageIds, caller);
    const hits: KnoloSearchHit[] = [];
    const receipts: KnoloSearchResult['receipts'] = [];

    for (const mount of mounts) {
      const queryResult = queryKnowledgeImageV5(
        mount.image,
        `FROM chunk SEARCH "${escapeEql(query)}" LIMIT ${limit}`
      );
      const authorization = evaluateKnowledgeQueryPolicyV5(
        mount.image,
        queryResult,
        mount.policy,
        mount.config.principal,
        'query'
      );
      if (authorization.decision === 'deny' && queryResult.hits.length > 0) {
        throw new KnoloPluginError(
          'ACCESS_DENIED',
          `Knolo policy denies query access to image ${mount.config.id}.`
        );
      }

      const returned = authorization.allowedHits.map((hit) => {
        const object = mount.image.objects.find(
          (candidate) => candidate.id === hit.objectId
        );
        if (!object) {
          throw new KnoloPluginError(
            'IMAGE_INVALID',
            `Verified result references missing object ${hit.objectId}.`
          );
        }
        const excerpt = readExcerpt(
          object.bytes,
          0,
          undefined,
          this.#config.maxExcerptBytes
        );
        return {
          objectId: hit.objectId,
          start: excerpt.start,
          end: excerpt.end,
        };
      });
      const receipt = await this.writeReceipt({
        imageId: mount.config.id,
        byteSha256: mount.byteSha256,
        stateRoot: mount.image.stateRoot,
        caller,
        query,
        queryResult,
        authorization,
        returned,
      });
      receipts.push({
        imageId: mount.config.id,
        receiptId: receipt.receiptId,
        stateRoot: queryResult.stateRoot,
        planRoot: queryResult.planRoot,
        resultRoot: queryResult.resultRoot,
      });
      for (const returnedHit of returned) {
        const hit = authorization.allowedHits.find(
          (candidate) => candidate.objectId === returnedHit.objectId
        );
        const object = mount.image.objects.find(
          (candidate) => candidate.id === returnedHit.objectId
        );
        if (!hit || !object) continue;
        const excerpt = readExcerpt(
          object.bytes,
          returnedHit.start,
          returnedHit.end,
          this.#config.maxExcerptBytes
        );
        hits.push({
          imageId: mount.config.id,
          objectId: hit.objectId,
          kind: hit.kind,
          excerpt: excerpt.text,
          start: excerpt.start,
          end: excerpt.end,
          stateRoot: queryResult.stateRoot,
          planRoot: queryResult.planRoot,
          resultRoot: queryResult.resultRoot,
          receiptId: receipt.receiptId,
        });
      }
    }
    return { version: 1, hits, receipts };
  }

  async get(
    request: KnoloGetRequest,
    caller: KnoloCaller
  ): Promise<KnoloGetResult> {
    const mount = this.requireMount(request.imageId, caller);
    if (request.stateRoot !== mount.image.stateRoot) {
      throw new KnoloPluginError(
        'STATE_ROOT_MISMATCH',
        `Image ${request.imageId} is no longer mounted at the requested state root.`
      );
    }
    if (!ROOT_PATTERN.test(request.stateRoot)) {
      throw new KnoloPluginError(
        'QUERY_INVALID',
        'stateRoot must be a V5 SHA-256 root.'
      );
    }
    const result = queryKnowledgeImageV5(
      mount.image,
      `FROM * WHERE id = "${escapeEql(request.objectId)}" LIMIT 1`
    );
    if (!result.hits.length) {
      throw new KnoloPluginError(
        'NOT_FOUND',
        'The requested evidence object does not exist.'
      );
    }
    const authorization = evaluateKnowledgeQueryPolicyV5(
      mount.image,
      result,
      mount.policy,
      mount.config.principal,
      'read'
    );
    if (
      authorization.decision !== 'allow' ||
      authorization.allowedHits.length !== 1
    ) {
      throw new KnoloPluginError(
        'ACCESS_DENIED',
        `Knolo policy denies read access to object ${request.objectId}.`
      );
    }
    const object = mount.image.objects.find(
      (candidate) => candidate.id === request.objectId
    );
    if (!object) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        'Verified image object lookup failed.'
      );
    }
    const excerpt = readExcerpt(
      object.bytes,
      request.start,
      request.end,
      this.#config.maxExcerptBytes
    );
    return {
      imageId: mount.config.id,
      objectId: object.id,
      kind: object.kind,
      content: excerpt.text,
      start: excerpt.start,
      end: excerpt.end,
      stateRoot: mount.image.stateRoot,
    };
  }

  async verify(
    imageId: string | undefined,
    caller: KnoloCaller
  ): Promise<KnoloVerification[]> {
    const mounts = imageId
      ? [this.requireMount(imageId, caller)]
      : this.selectMounts(undefined, caller);
    const results: KnoloVerification[] = [];
    for (const mount of mounts) {
      const checked = await loadMount(mount.config, this.#config.maxImageBytes);
      results.push({
        imageId: checked.config.id,
        byteSha256: checked.byteSha256,
        stateRoot: checked.image.stateRoot,
        commitDigest: checked.image.commitDigest,
        valid: true,
      });
    }
    return results;
  }

  status(caller: KnoloCaller): KnoloStatus[] {
    return this.selectMounts(undefined, caller).map((mount) => ({
      imageId: mount.config.id,
      stateRoot: mount.image.stateRoot,
      source: 'local',
      status: 'ready',
    }));
  }

  async verifyReceipt(receiptId: string): Promise<void> {
    if (!/^qr_[a-f0-9]{24}$/u.test(receiptId)) {
      throw new KnoloPluginError('QUERY_INVALID', 'Invalid Knolo receipt ID.');
    }
    const receiptPath = path.join(this.#config.auditDir, `${receiptId}.json`);
    let receipt: KnoloQueryReceiptV1;
    try {
      receipt = JSON.parse(
        await readFile(receiptPath, 'utf8')
      ) as KnoloQueryReceiptV1;
    } catch {
      throw new KnoloPluginError('NOT_FOUND', 'Knolo receipt was not found.');
    }
    const configuredMount = this.#mounts.get(receipt.imageId);
    if (!configuredMount) {
      throw new KnoloPluginError(
        'IMAGE_UNAVAILABLE',
        'The receipt image is not mounted.'
      );
    }
    const mount = await loadMount(
      configuredMount.config,
      this.#config.maxImageBytes
    );
    if (mount.image.stateRoot !== receipt.stateRoot) {
      throw new KnoloPluginError(
        'STATE_ROOT_MISMATCH',
        'The receipt image is not mounted at its recorded root.'
      );
    }
    if (mount.byteSha256 !== receipt.byteSha256) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        'The receipt byte digest does not match the mounted image.'
      );
    }
    const { recordDigest, ...body } = receipt;
    if (recordDigest !== receiptDigest(body)) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        'Knolo receipt digest mismatch.'
      );
    }
    verifyKnowledgeQueryResultV5(mount.image, receipt.queryResult);
    const authorization = evaluateKnowledgeQueryPolicyV5(
      mount.image,
      receipt.queryResult,
      mount.policy,
      mount.config.principal,
      'query'
    );
    if (
      JSON.stringify(authorization) !== JSON.stringify(receipt.authorization)
    ) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        'Knolo receipt authorization mismatch.'
      );
    }
    for (const entry of receipt.returned) {
      if (
        !authorization.allowedHits.some(
          (hit) => hit.objectId === entry.objectId
        )
      ) {
        throw new KnoloPluginError(
          'IMAGE_INVALID',
          'Knolo receipt returned an unauthorized object.'
        );
      }
      const object = mount.image.objects.find(
        (candidate) => candidate.id === entry.objectId
      );
      if (
        !object ||
        entry.start < 0 ||
        entry.end < entry.start ||
        entry.end > object.bytes.length
      ) {
        throw new KnoloPluginError(
          'IMAGE_INVALID',
          'Knolo receipt contains an invalid evidence range.'
        );
      }
      readExcerpt(
        object.bytes,
        entry.start,
        entry.end,
        this.#config.maxExcerptBytes
      );
    }
  }

  private selectMounts(
    imageIds: string[] | undefined,
    caller: KnoloCaller
  ): MountSnapshot[] {
    assertCaller(caller);
    const requested =
      imageIds === undefined
        ? this.#config.mounts.map((mount) => mount.id)
        : imageIds;
    if (!Array.isArray(requested) || !requested.length) {
      throw new KnoloPluginError(
        'QUERY_INVALID',
        'At least one mounted image is required.'
      );
    }
    if (new Set(requested).size !== requested.length) {
      throw new KnoloPluginError('QUERY_INVALID', 'Image IDs must be unique.');
    }
    return requested.map((id) => this.requireMount(id, caller));
  }

  private requireMount(imageId: string, caller: KnoloCaller): MountSnapshot {
    assertCaller(caller);
    const mount = this.#mounts.get(imageId);
    if (!mount) {
      throw new KnoloPluginError(
        'IMAGE_UNAVAILABLE',
        `Knolo image ${imageId} is not mounted.`
      );
    }
    if (!mount.config.agents.includes(caller.agentId)) {
      throw new KnoloPluginError(
        'ACCESS_DENIED',
        `Agent ${caller.agentId} cannot access image ${imageId}.`
      );
    }
    return mount;
  }

  private async writeReceipt(
    input: Omit<
      KnoloQueryReceiptV1,
      'version' | 'receiptId' | 'recordDigest' | 'createdAt'
    >
  ): Promise<KnoloQueryReceiptV1> {
    const createdAt = new Date().toISOString();
    const receiptId = `qr_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const body = {
      version: OPENCLAW_KNOLO_RECEIPT_VERSION,
      receiptId,
      createdAt,
      ...input,
    } satisfies Omit<KnoloQueryReceiptV1, 'recordDigest'>;
    const receipt = { ...body, recordDigest: receiptDigest(body) };
    try {
      await mkdir(this.#config.auditDir, { recursive: true, mode: 0o700 });
      const target = path.join(this.#config.auditDir, `${receiptId}.json`);
      const temporary = path.join(
        this.#config.auditDir,
        `.${receiptId}.${randomUUID()}.tmp`
      );
      await writeFile(temporary, `${JSON.stringify(receipt)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      throw new KnoloPluginError(
        'AUDIT_UNAVAILABLE',
        `Could not persist the Knolo query record: ${safeErrorMessage(error)}`
      );
    }
    return receipt;
  }
}

function normalizeConfig(config: KnoloPluginConfig): NormalizedConfig {
  if (!config || typeof config !== 'object' || !Array.isArray(config.mounts)) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      'Knolo configuration requires mounts.'
    );
  }
  if (!config.auditDir || typeof config.auditDir !== 'string') {
    throw new KnoloPluginError(
      'AUDIT_UNAVAILABLE',
      'Knolo configuration requires auditDir.'
    );
  }
  const ids = new Set<string>();
  const mounts = config.mounts.map((mount) => {
    if (!mount || !ID_PATTERN.test(mount.id) || ids.has(mount.id)) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        'Knolo mount IDs must be unique and safe.'
      );
    }
    ids.add(mount.id);
    if (
      !mount.path ||
      !mount.policyPath ||
      !SHA256_PATTERN.test(mount.sha256) ||
      !ROOT_PATTERN.test(mount.stateRoot)
    ) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `Knolo mount ${mount.id} has invalid pins.`
      );
    }
    if (
      !Array.isArray(mount.agents) ||
      !mount.agents.length ||
      mount.agents.some((agent) => !agent || typeof agent !== 'string')
    ) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `Knolo mount ${mount.id} must allow at least one agent.`
      );
    }
    if (!mount.principal || typeof mount.principal !== 'string') {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `Knolo mount ${mount.id} requires a principal.`
      );
    }
    return { ...mount, agents: [...new Set(mount.agents)] };
  });
  if (!mounts.length)
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      'Knolo configuration requires at least one mount.'
    );
  return {
    mounts,
    auditDir: path.resolve(config.auditDir),
    maxImageBytes: positiveInteger(
      config.maxImageBytes,
      DEFAULT_MAX_IMAGE_BYTES,
      512 * 1024 * 1024,
      'maxImageBytes'
    ),
    maxHits: positiveInteger(config.maxHits, DEFAULT_MAX_HITS, 1000, 'maxHits'),
    maxExcerptBytes: positiveInteger(
      config.maxExcerptBytes,
      DEFAULT_MAX_EXCERPT_BYTES,
      64 * 1024,
      'maxExcerptBytes'
    ),
    maxQueryBytes: positiveInteger(
      config.maxQueryBytes,
      DEFAULT_MAX_QUERY_BYTES,
      16 * 1024,
      'maxQueryBytes'
    ),
  };
}

async function loadMount(
  config: KnoloMountConfig,
  maxImageBytes: number
): Promise<MountSnapshot> {
  let metadata;
  let bytes: Uint8Array;
  try {
    metadata = await stat(config.path);
    if (!metadata.isFile() || metadata.size > maxImageBytes) {
      throw new Error(
        `image must be a file no larger than ${maxImageBytes} bytes`
      );
    }
    bytes = new Uint8Array(await readFile(config.path));
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_UNAVAILABLE',
      `Could not load image ${config.id}: ${safeErrorMessage(error)}`
    );
  }
  const byteSha256 = sha256(bytes);
  if (byteSha256 !== config.sha256) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Image ${config.id} does not match its SHA-256 pin.`
    );
  }
  let image: KnowledgeImageV5;
  try {
    verifyKnowledgeImageV5(bytes);
    image = mountKnowledgeImageV5(bytes);
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Image ${config.id} failed V5 verification: ${safeErrorMessage(error)}`
    );
  }
  if (image.stateRoot !== config.stateRoot) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Image ${config.id} does not match its state-root pin.`
    );
  }
  let policy: KnowledgePolicyV1;
  try {
    policy = JSON.parse(
      await readFile(config.policyPath, 'utf8')
    ) as KnowledgePolicyV1;
    if (knowledgePolicyRootV5(policy) !== image.commit.policyRoot) {
      throw new Error('policy root does not match the image commit');
    }
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Policy for image ${config.id} is invalid: ${safeErrorMessage(error)}`
    );
  }
  return { config, image, policy, byteSha256 };
}

function normalizeQuery(query: string, maxBytes: number): string {
  if (typeof query !== 'string') {
    throw new KnoloPluginError('QUERY_INVALID', 'query must be a string.');
  }
  const normalized = query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized)
    throw new KnoloPluginError('QUERY_INVALID', 'query must not be empty.');
  if (new TextEncoder().encode(normalized).length > maxBytes) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `query exceeds ${maxBytes} UTF-8 bytes.`
    );
  }
  return normalized;
}

function normalizeLimit(limit: number | undefined, maximum: number): number {
  const value = limit ?? maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `limit must be an integer between 1 and ${maximum}.`
    );
  }
  return value;
}

function readExcerpt(
  bytes: Uint8Array,
  requestedStart: number | undefined,
  requestedEnd: number | undefined,
  maximum: number
) {
  const start = requestedStart ?? 0;
  const requested = requestedEnd ?? bytes.length;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(requested) ||
    start < 0 ||
    requested < start ||
    requested > bytes.length
  ) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Evidence byte range is invalid.'
    );
  }
  const end = Math.min(requested, start + maximum);
  let safeEnd = end;
  while (safeEnd >= start) {
    try {
      return {
        text: decoder.decode(bytes.slice(start, safeEnd)),
        start,
        end: safeEnd,
      };
    } catch {
      safeEnd--;
    }
  }
  throw new KnoloPluginError(
    'IMAGE_INVALID',
    'Evidence object is not valid UTF-8.'
  );
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `${name} must be an integer between 1 and ${maximum}.`
    );
  }
  return resolved;
}

function assertCaller(caller: KnoloCaller): void {
  if (!caller || typeof caller.agentId !== 'string' || !caller.agentId) {
    throw new KnoloPluginError(
      'ACCESS_DENIED',
      'Knolo requires a trusted OpenClaw agent identity.'
    );
  }
}

function escapeEql(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function receiptDigest(
  receipt: Omit<KnoloQueryReceiptV1, 'recordDigest'>
): string {
  return digestDomain(
    'openclaw-query-receipt',
    canonicalCbor(receipt as never)
  );
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
