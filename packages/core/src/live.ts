import { buildPack, type BuildInputDoc, type BuildPackOptions } from './builder.js';
import type { Pack } from './pack.runtime.js';
import { mountPack } from './pack.runtime.js';
import {
  query as queryPack,
  validateQueryOptions,
  type Hit,
  type QueryOptions,
} from './query.js';

export type LivePackOptions = {
  graph?: {
    enabled?: boolean;
    maxEdgesPerDoc?: number;
  };
};

type LiveDoc = BuildInputDoc & { id: string };

type BaseDocEntry = {
  index: number;
  id?: string;
  text: string;
  heading?: string;
  namespace?: string;
};

type NormalizedLivePackOptions = {
  graph: {
    enabled: boolean;
    maxEdgesPerDoc?: number;
  };
};

export class LivePack {
  public readonly base: Readonly<Pack>;

  private readonly graph: NormalizedLivePackOptions['graph'];
  private readonly baseEntries: BaseDocEntry[];
  private readonly baseDocsById: Map<string, BaseDocEntry>;
  private overlay = new Map<string, LiveDoc>();
  private tombstones = new Set<string>();
  // Materialized merged view so BM25 sees one corpus-wide IDF.
  private merged: Pack;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(base: Pack, opts: LivePackOptions = {}) {
    this.base = base;
    this.graph = normalizeLiveGraphOptions(base, opts);
    this.baseEntries = extractBaseEntries(base);
    this.baseDocsById = indexBaseEntries(this.baseEntries);
    this.merged = base;
  }

  public async addDocument(doc: LiveDoc): Promise<this> {
    return this.enqueueMutation(async () => {
      const nextDoc = normalizeLiveDocument(doc);
      const nextOverlay = new Map(this.overlay);
      const nextTombstones = new Set(this.tombstones);

      nextOverlay.set(nextDoc.id, nextDoc);
      nextTombstones.delete(nextDoc.id);

      const nextMerged = await buildMergedPack(
        this.baseEntries,
        nextOverlay,
        nextTombstones,
        this.graph,
        this.base.meta.agents
      );
      this.overlay = nextOverlay;
      this.tombstones = nextTombstones;
      this.merged = nextMerged;
    });
  }

  public async updateDocument(doc: LiveDocumentPatch): Promise<this> {
    return this.enqueueMutation(async () => {
      const patch = normalizeLivePatch(doc);
      const current = this.getMutableDoc(patch.id);
      if (!current) {
        throw new Error(
          `LivePack.updateDocument(...): unknown id "${patch.id}". Use addDocument() to insert new live docs.`
        );
      }

      const nextDoc = mergeLiveDoc(current, patch);
      const nextOverlay = new Map(this.overlay);
      const nextTombstones = new Set(this.tombstones);

      nextOverlay.set(nextDoc.id, nextDoc);
      nextTombstones.delete(nextDoc.id);

      const nextMerged = await buildMergedPack(
        this.baseEntries,
        nextOverlay,
        nextTombstones,
        this.graph,
        this.base.meta.agents
      );
      this.overlay = nextOverlay;
      this.tombstones = nextTombstones;
      this.merged = nextMerged;
    });
  }

  public async removeDocument(id: string): Promise<this> {
    return this.enqueueMutation(async () => {
      const normalizedId = normalizeLiveId(id, 'LivePack.removeDocument(...)');
      const current = this.getMutableDoc(normalizedId);
      if (!current) {
        throw new Error(
          `LivePack.removeDocument(...): unknown id "${normalizedId}".`
        );
      }

      const nextOverlay = new Map(this.overlay);
      const nextTombstones = new Set(this.tombstones);

      nextOverlay.delete(normalizedId);
      nextTombstones.add(normalizedId);

      const nextMerged = await buildMergedPack(
        this.baseEntries,
        nextOverlay,
        nextTombstones,
        this.graph,
        this.base.meta.agents
      );
      this.overlay = nextOverlay;
      this.tombstones = nextTombstones;
      this.merged = nextMerged;
    });
  }

  public query(q: string, opts: QueryOptions = {}): Hit[] {
    validateLiveQueryOptions(opts);
    return queryPack(this.merged, q, sanitizeLiveQueryOptions(opts));
  }

  public async serialize(): Promise<Uint8Array> {
    await this.mutationQueue;
    const docs = this.collectMergedDocs();
    const buildOpts: Parameters<typeof buildPack>[1] = this.graph.enabled
      ? {
          graph: {
            enabled: true,
            ...(this.graph.maxEdgesPerDoc !== undefined
            ? { maxEdgesPerDoc: this.graph.maxEdgesPerDoc }
            : {}),
          },
          ...(this.base.meta.agents ? { agents: this.base.meta.agents } : {}),
        }
      : {
          graph: { enabled: false },
          ...(this.base.meta.agents ? { agents: this.base.meta.agents } : {}),
        };

    return await buildPack(docs, buildOpts);
  }

  private async enqueueMutation(task: () => Promise<void>): Promise<this> {
    const run = this.mutationQueue.then(() => task(), () => task());
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run.then(() => this);
  }

  private getMutableDoc(id: string): LiveDoc | undefined {
    const overlay = this.overlay.get(id);
    if (overlay) return overlay;
    if (this.tombstones.has(id)) return undefined;

    const base = this.baseDocsById.get(id);
    if (!base) return undefined;
    return baseEntryToDoc(base) as LiveDoc;
  }

  private collectMergedDocs(): BuildInputDoc[] {
    return collectMergedDocsFromState(this.baseEntries, this.overlay, this.tombstones);
  }
}

export async function createLivePack(
  base: Pack,
  docs: LiveDoc[] = [],
  opts: LivePackOptions = {}
): Promise<LivePack> {
  const live = new LivePack(base, opts);
  for (const doc of docs) {
    await live.addDocument(doc);
  }
  return live;
}

type LiveDocumentPatch = {
  id: string;
  text?: string;
  heading?: string;
  namespace?: string;
};

function normalizeLiveGraphOptions(
  base: Pack,
  opts: LivePackOptions
): NormalizedLivePackOptions['graph'] {
  const graphRequested = opts.graph?.enabled;
  const inferredEnabled =
    graphRequested ??
    (opts.graph?.maxEdgesPerDoc !== undefined ? true : Boolean(base.meta.claimGraph));

  if (!inferredEnabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    ...(opts.graph?.maxEdgesPerDoc !== undefined
      ? { maxEdgesPerDoc: opts.graph.maxEdgesPerDoc }
      : {}),
  };
}

function extractBaseEntries(base: Pack): BaseDocEntry[] {
  return base.blocks.map((text, index) => ({
    index,
    text,
    heading: base.headings?.[index] ?? undefined,
    namespace: base.namespaces?.[index] ?? undefined,
    id: normalizeBaseDocId(base.docIds?.[index]),
  }));
}

function indexBaseEntries(entries: BaseDocEntry[]): Map<string, BaseDocEntry> {
  const index = new Map<string, BaseDocEntry>();
  for (const entry of entries) {
    if (entry.id === undefined) continue;
    if (index.has(entry.id)) {
      throw new Error(
        `LivePack requires stable doc ids. Duplicate base doc id "${entry.id}" is not supported.`
      );
    }
    index.set(entry.id, entry);
  }
  return index;
}

function normalizeBaseDocId(id: string | null | undefined): string | undefined {
  if (id === undefined || id === null) return undefined;
  const normalized = normalizeLiveId(id, 'base pack');
  return normalized;
}

function normalizeLiveDocument(doc: LiveDoc): LiveDoc {
  if (!doc || typeof doc !== 'object') {
    throw new Error('LivePack expects document objects with stable ids.');
  }

  const id = normalizeLiveId(doc.id, 'LivePack document');
  const text = normalizeLiveText(doc.text, `LivePack document "${id}"`);
  const heading = validateOptionalString(doc.heading, 'heading', id);
  const namespace = validateOptionalString(doc.namespace, 'namespace', id);

  return {
    id,
    text,
    ...(heading !== undefined ? { heading } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
  };
}

function normalizeLivePatch(patch: LiveDocumentPatch): LiveDocumentPatch {
  if (!patch || typeof patch !== 'object') {
    throw new Error('LivePack.updateDocument(...) expects an object with an id.');
  }

  const id = normalizeLiveId(patch.id, 'LivePack.updateDocument(...)');
  const out: LiveDocumentPatch = { id };

  if (patch.text !== undefined) {
    out.text = normalizeLiveText(
      patch.text,
      `LivePack.updateDocument("${id}")`
    );
  }
  if (patch.heading !== undefined) {
    out.heading = validateOptionalString(patch.heading, 'heading', id);
  }
  if (patch.namespace !== undefined) {
    out.namespace = validateOptionalString(patch.namespace, 'namespace', id);
  }
  return out;
}

function mergeLiveDoc(current: LiveDoc, patch: LiveDocumentPatch): LiveDoc {
  const next: LiveDoc = {
    id: current.id,
    text: current.text,
    ...(current.heading !== undefined ? { heading: current.heading } : {}),
    ...(current.namespace !== undefined ? { namespace: current.namespace } : {}),
  };

  if (patch.text !== undefined) next.text = patch.text;
  if (patch.heading !== undefined) next.heading = patch.heading;
  if (patch.namespace !== undefined) next.namespace = patch.namespace;

  return cloneLiveDoc(next);
}

function cloneLiveDoc(doc: LiveDoc): LiveDoc {
  return {
    id: doc.id,
    text: doc.text,
    ...(doc.heading !== undefined ? { heading: doc.heading } : {}),
    ...(doc.namespace !== undefined ? { namespace: doc.namespace } : {}),
  };
}

function baseEntryToDoc(entry: BaseDocEntry): BuildInputDoc {
  return {
    id: entry.id,
    text: entry.text,
    ...(entry.heading !== undefined ? { heading: entry.heading } : {}),
    ...(entry.namespace !== undefined ? { namespace: entry.namespace } : {}),
  };
}

function validateLiveQueryOptions(opts: QueryOptions): void {
  if (opts.semantic) {
    const semanticEntries = Object.entries(opts.semantic).filter(
      ([key, value]) => key !== 'enabled' && value !== undefined
    );
    if (opts.semantic.enabled === true || semanticEntries.length > 0) {
      throw new Error(
        'LivePack.query(...): semantic query options are not supported in v1.'
      );
    }
  }
  validateQueryOptions({ ...opts, semantic: undefined });
}

function sanitizeLiveQueryOptions(opts: QueryOptions): QueryOptions {
  return {
    ...opts,
    semantic: undefined,
  };
}

async function buildMergedPack(
  baseEntries: BaseDocEntry[],
  overlay: Map<string, LiveDoc>,
  tombstones: Set<string>,
  graph: NormalizedLivePackOptions['graph'],
  agents?: BuildPackOptions['agents']
): Promise<Pack> {
  const docs = collectMergedDocsFromState(baseEntries, overlay, tombstones);
  const bytes = await buildPack(docs, createBuildPackOptions(graph, agents));
  return await mountPack({ src: bytes });
}

function collectMergedDocsFromState(
  baseEntries: BaseDocEntry[],
  overlay: Map<string, LiveDoc>,
  tombstones: Set<string>
): BuildInputDoc[] {
  const hidden = new Set<string>(tombstones);
  for (const id of overlay.keys()) hidden.add(id);

  const named = new Map<string, BuildInputDoc>();
  const anonymous: BuildInputDoc[] = [];

  for (const entry of baseEntries) {
    if (entry.id === undefined) {
      anonymous.push(baseEntryToDoc(entry));
      continue;
    }
    if (hidden.has(entry.id)) continue;
    named.set(entry.id, baseEntryToDoc(entry));
  }

  for (const [id, doc] of overlay) {
    named.set(id, cloneLiveDoc(doc));
  }

  const sortedNamed = [...named.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, doc]) => doc);

  return [...sortedNamed, ...anonymous];
}

function createBuildPackOptions(
  graph: NormalizedLivePackOptions['graph'],
  agents?: BuildPackOptions['agents']
): BuildPackOptions {
  return graph.enabled
    ? {
        graph: {
          enabled: true,
          ...(graph.maxEdgesPerDoc !== undefined
            ? { maxEdgesPerDoc: graph.maxEdgesPerDoc }
            : {}),
        },
        ...(agents ? { agents } : {}),
      }
    : {
        graph: { enabled: false },
        ...(agents ? { agents } : {}),
      };
}

function normalizeLiveId(id: unknown, context: string): string {
  if (typeof id !== 'string') {
    throw new Error(`${context}: id must be a non-empty string.`);
  }
  if (!id.trim()) {
    throw new Error(`${context}: id must be a non-empty string.`);
  }
  return id;
}

function normalizeLiveText(text: unknown, context: string): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`${context}: text must be a non-empty string.`);
  }
  return text;
}

function validateOptionalString(
  value: unknown,
  field: 'heading' | 'namespace',
  id: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(
      `LivePack document "${id}": ${field} must be a string when provided.`
    );
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
