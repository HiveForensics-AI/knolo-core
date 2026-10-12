import { inspectPackV4 } from '../pack.v4.js';
import {
  mountKnowledgeImageV5,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from '../knowledge_image_v5.js';
import {
  AVAILABILITIES,
  COMPOSITION_FORMAT,
  COMPOSITION_MAX_DEPTH,
  COMPOSITION_MAX_FILES,
  COMPOSITION_MAX_MEMBERS,
  COMPOSITION_RECORD_DOMAIN,
  FILE_SET_DOMAIN,
  MEMBER_KINDS,
  ROLE_FOR_KIND,
} from './constants.js';
import {
  asBytes,
  compareUtf16,
  copyBuffer,
  exactKeys,
  fileSha256,
  isDigest,
  isRecord,
  requireDigest,
  requireToken,
  rooted,
  validRelativePath,
} from './codec.js';
import { CompositionError } from './errors.js';
import { verifyBoundedExcerpt } from './excerpt.js';

export type MemberKind = (typeof MEMBER_KINDS)[number];
export type Availability = 'material' | 'digest';
export type CompositionRole = (typeof ROLE_FOR_KIND)[MemberKind];

export type CompositionHost =
  | { kind: 'none' }
  | {
      kind: 'v5-image';
      stateRoot: Digest;
      objectRoot: Digest;
      commitDigest: Digest;
      knowledgeRoot?: Digest;
    };

export type PolicyEntry = { alias: string; kind: MemberKind };

export type CompositionPolicy = {
  default: 'allow' | 'deny';
  allow: PolicyEntry[];
  deny: PolicyEntry[];
};

type MemberBase = { alias: string; kind: MemberKind; role: CompositionRole };

export type V5Member = MemberBase & {
  kind: 'v5-image';
  role: 'dependency';
  stateRoot: Digest;
  objectRoot: Digest;
  commitDigest: Digest;
  sha256: Digest;
  knowledgeRoot?: Digest;
};

export type V4Member = MemberBase & {
  kind: 'v4-pack';
  role: 'dependency';
  packDigest: Digest;
  manifestDigest: Digest;
  sha256: Digest;
};

export type KarMember = MemberBase & {
  kind: 'kar-sidecar';
  role: 'evidence';
  bindsTo: string;
  semanticRoot: Digest;
  knowledgeRoot: Digest;
  sha256: Digest;
};

export type DomainMember = MemberBase & {
  kind: 'domain-pack';
  role: 'vocabulary';
  id: string;
  version: string;
  root: Digest;
  filesRoot: Digest;
};

export type ExcerptMember = MemberBase & {
  kind: 'excerpt';
  role: 'excerpt';
  excerptRoot: Digest;
  parentStateRoot: Digest;
  parentObjectRoot: Digest;
  parentCommitDigest: Digest;
  inclusion: 'included' | 'digest-bound';
};

export type NestedMember = MemberBase & {
  kind: 'composition';
  role: 'nested';
  compositionRoot: Digest;
};

export type CompositionMember = V5Member | V4Member | KarMember | DomainMember | ExcerptMember | NestedMember;

export type CompositionRecord = {
  format: typeof COMPOSITION_FORMAT;
  version: 1;
  compositionRoot: Digest;
  host: CompositionHost;
  availability: Availability;
  policy: CompositionPolicy;
  members: CompositionMember[];
};

export type DomainPackIdentity = { id: string; version: string; root: Digest };

export type KarBinding = {
  knowledgeRoot: Digest;
  semanticRoot: Digest;
  stateRoot: Digest;
  objectRoot: Digest;
  commitDigest: Digest;
};

export type MemberMaterial =
  | { bytes: Uint8Array }
  | { files: { path: string; bytes: Uint8Array }[] }
  | { record: CompositionRecord; members?: Record<string, MemberMaterial>; hostBytes?: Uint8Array }
  | { excerptRoot: Digest; parentBytes?: Uint8Array }
  | { excerpt: unknown; parentBytes?: Uint8Array };

export type CompositionCreateInput = {
  host?: CompositionHostInput;
  members: CompositionMemberInput[];
  availability?: Availability;
  policy?: CompositionPolicyInput;
  domainPackRoot?: (files: { path: string; bytes: Uint8Array }[]) => DomainPackIdentity | null;
  karBinder?: (image: Uint8Array, graph: Uint8Array) => KarBinding;
};

export type CompositionHostInput =
  | { kind: 'none' }
  | {
      kind?: 'v5-image';
      bytes?: Uint8Array;
      stateRoot?: Digest;
      objectRoot?: Digest;
      commitDigest?: Digest;
      knowledgeRoot?: Digest;
    };

export type CompositionPolicyInput = {
  default?: 'allow' | 'deny';
  allow?: PolicyEntry[];
  deny?: PolicyEntry[];
};

export type CompositionMemberInput = {
  alias: string;
  kind: MemberKind;
  role?: CompositionRole;
  bytes?: Uint8Array;
  files?: { path: string; bytes: Uint8Array }[];
  stateRoot?: Digest;
  objectRoot?: Digest;
  commitDigest?: Digest;
  sha256?: Digest;
  knowledgeRoot?: Digest;
  packDigest?: Digest;
  manifestDigest?: Digest;
  bindsTo?: string;
  semanticRoot?: Digest;
  id?: string;
  version?: string;
  root?: Digest;
  filesRoot?: Digest;
  excerptRoot?: Digest;
  parentStateRoot?: Digest;
  parentObjectRoot?: Digest;
  parentCommitDigest?: Digest;
  inclusion?: 'included' | 'digest-bound';
  compositionRoot?: Digest;
  record?: CompositionRecord;
};

export type CompositionVerifyOptions = {
  hostBytes?: Uint8Array;
  members?: Record<string, MemberMaterial>;
  requireMaterial?: boolean;
  domainPackRoot?: (files: { path: string; bytes: Uint8Array }[]) => DomainPackIdentity | null;
  karBinder?: (image: Uint8Array, graph: Uint8Array) => KarBinding;
  nested?: Record<string, { record: CompositionRecord; members?: Record<string, MemberMaterial>; hostBytes?: Uint8Array }>;
};

export type CompositionMemberStatus = { alias: string; status: 'material' | 'digest-bound' };

export type CompositionVerification =
  | { ok: true; compositionRoot: Digest; availability: Availability; members: CompositionMemberStatus[] }
  | { ok: false; code: CompositionError['code']; path?: string };

export function compositionFileSetRoot(files: { path: string; sha256: Digest }[]): Digest {
  const rows = files.map((file) => ({ path: file.path, sha256: file.sha256 }));
  rows.sort((left, right) => compareUtf16(left.path, right.path));
  return rooted(FILE_SET_DOMAIN, rows as unknown as CborValue);
}

export function createCompositionRecord(input: CompositionCreateInput): { record: CompositionRecord; compositionRoot: Digest } {
  const availability = input.availability ?? 'material';
  if (!AVAILABILITIES.includes(availability)) {
    throw new CompositionError('COMPOSITION_INVALID', 'availability must be material or digest.', 'availability');
  }
  if (!Array.isArray(input.members) || input.members.length === 0) {
    throw new CompositionError('COMPOSITION_INVALID', 'A composition needs at least one member.', 'members');
  }
  if (input.members.length > COMPOSITION_MAX_MEMBERS) {
    throw new CompositionError('COMPOSITION_INVALID', `A composition accepts at most ${COMPOSITION_MAX_MEMBERS} members.`, 'members');
  }
  const host = normalizeHost(input.host, availability);
  const members = input.members
    .map((member) => normalizeMember(member, availability, host, input))
    .sort((left, right) => compareUtf16(left.alias, right.alias));
  rejectDuplicates(host, members);
  const policy = normalizePolicy(input.policy, members);
  const record = finish({ host, availability, policy, members });
  return { record, compositionRoot: record.compositionRoot };
}

export function verifyCompositionRecord(record: unknown, options: CompositionVerifyOptions = {}): CompositionVerification {
  try {
    const parsed = parseCompositionRecord(record);
    const recomputed = compositionRootOf(parsed);
    if (recomputed !== parsed.compositionRoot) {
      return { ok: false, code: 'COMPOSITION_ROOT_MISMATCH', path: 'compositionRoot' };
    }
    const statuses = walk(parsed, [], new Set(), options, options.requireMaterial === true || parsed.availability === 'material');
    return { ok: true, compositionRoot: parsed.compositionRoot, availability: parsed.availability, members: statuses };
  } catch (error) {
    if (error instanceof CompositionError) {
      return { ok: false, code: error.code, ...(error.path ? { path: error.path } : {}) };
    }
    return { ok: false, code: 'COMPOSITION_INVALID' };
  }
}

export function assertCompositionRoot(value: unknown): CompositionRecord {
  const record = parseCompositionRecord(value);
  if (compositionRootOf(record) !== record.compositionRoot) {
    throw new CompositionError('COMPOSITION_ROOT_MISMATCH', 'compositionRoot does not match the record.', 'compositionRoot');
  }
  return record;
}

export function parseCompositionRecord(value: unknown): CompositionRecord {
  if (!isRecord(value)) throw new CompositionError('COMPOSITION_INVALID', 'Composition record must be an object.');
  exactKeys(value, ['format', 'version', 'compositionRoot', 'host', 'availability', 'policy', 'members'], 'record');
  if (value.format !== COMPOSITION_FORMAT || value.version !== 1) {
    throw new CompositionError('COMPOSITION_UNSUPPORTED', 'Unsupported composition record format.', 'format');
  }
  if (!AVAILABILITIES.includes(value.availability as Availability)) {
    throw new CompositionError('COMPOSITION_INVALID', 'availability must be material or digest.', 'availability');
  }
  const host = parseHost(value.host);
  const members = parseMembers(value.members);
  const policy = parsePolicy(value.policy, members);
  rejectDuplicates(host, members);
  const record: CompositionRecord = {
    format: COMPOSITION_FORMAT,
    version: 1,
    compositionRoot: requireDigest(value.compositionRoot, 'compositionRoot'),
    host,
    availability: value.availability as Availability,
    policy,
    members,
  };
  return record;
}

function finish(parts: Omit<CompositionRecord, 'format' | 'version' | 'compositionRoot'>): CompositionRecord {
  const body = recordBody(parts.host, parts.availability, parts.policy, parts.members);
  return {
    format: COMPOSITION_FORMAT,
    version: 1,
    compositionRoot: rooted(COMPOSITION_RECORD_DOMAIN, body),
    ...parts,
  };
}

function recordBody(host: CompositionHost, availability: Availability, policy: CompositionPolicy, members: CompositionMember[]): CborValue {
  return {
    version: 1,
    format: COMPOSITION_FORMAT,
    host: hostBody(host),
    availability,
    policy: {
      default: policy.default,
      allow: policy.allow.map((entry) => ({ alias: entry.alias, kind: entry.kind })),
      deny: policy.deny.map((entry) => ({ alias: entry.alias, kind: entry.kind })),
    },
    members: members.map(memberBody),
  } as unknown as CborValue;
}

function compositionRootOf(record: CompositionRecord): Digest {
  return rooted(COMPOSITION_RECORD_DOMAIN, recordBody(record.host, record.availability, record.policy, record.members));
}

function hostBody(host: CompositionHost): CborValue {
  if (host.kind === 'none') return { kind: 'none' };
  const body: Record<string, string> = {
    kind: 'v5-image',
    stateRoot: host.stateRoot,
    objectRoot: host.objectRoot,
    commitDigest: host.commitDigest,
  };
  if (host.knowledgeRoot) body.knowledgeRoot = host.knowledgeRoot;
  return body as unknown as CborValue;
}

function memberBody(member: CompositionMember): CborValue {
  const common = { alias: member.alias, kind: member.kind, role: member.role };
  if (member.kind === 'v5-image') {
    const body: Record<string, string> = { ...common, stateRoot: member.stateRoot, objectRoot: member.objectRoot, commitDigest: member.commitDigest, sha256: member.sha256 };
    if (member.knowledgeRoot) body.knowledgeRoot = member.knowledgeRoot;
    return body as unknown as CborValue;
  }
  if (member.kind === 'v4-pack') {
    return { ...common, packDigest: member.packDigest, manifestDigest: member.manifestDigest, sha256: member.sha256 } as unknown as CborValue;
  }
  if (member.kind === 'kar-sidecar') {
    return { ...common, bindsTo: member.bindsTo, semanticRoot: member.semanticRoot, knowledgeRoot: member.knowledgeRoot, sha256: member.sha256 } as unknown as CborValue;
  }
  if (member.kind === 'domain-pack') {
    return { ...common, id: member.id, version: member.version, root: member.root, filesRoot: member.filesRoot } as unknown as CborValue;
  }
  if (member.kind === 'excerpt') {
    return {
      ...common,
      excerptRoot: member.excerptRoot,
      parentStateRoot: member.parentStateRoot,
      parentObjectRoot: member.parentObjectRoot,
      parentCommitDigest: member.parentCommitDigest,
      inclusion: member.inclusion,
    } as unknown as CborValue;
  }
  return { ...common, compositionRoot: member.compositionRoot } as unknown as CborValue;
}

function normalizeHost(input: CompositionHostInput | undefined, availability: Availability): CompositionHost {
  if (!input || input.kind === 'none') return { kind: 'none' };
  if (input.bytes) {
    const image = mountImage(input.bytes, 'host');
    const host: CompositionHost = {
      kind: 'v5-image',
      stateRoot: image.stateRoot,
      objectRoot: image.commit.objectRoot,
      commitDigest: image.commitDigest,
    };
    if (input.knowledgeRoot) host.knowledgeRoot = requireDigest(input.knowledgeRoot, 'host.knowledgeRoot');
    agree(host.stateRoot, input.stateRoot, 'host.stateRoot');
    agree(host.objectRoot, input.objectRoot, 'host.objectRoot');
    agree(host.commitDigest, input.commitDigest, 'host.commitDigest');
    return host;
  }
  if (availability === 'material') throw new CompositionError('COMPOSITION_MEMBER_MISSING', 'Material composition is missing the host image.', 'host');
  const host: CompositionHost = {
    kind: 'v5-image',
    stateRoot: requireDigest(input.stateRoot, 'host.stateRoot'),
    objectRoot: requireDigest(input.objectRoot, 'host.objectRoot'),
    commitDigest: requireDigest(input.commitDigest, 'host.commitDigest'),
  };
  if (input.knowledgeRoot) host.knowledgeRoot = requireDigest(input.knowledgeRoot, 'host.knowledgeRoot');
  return host;
}

function normalizeMember(
  input: CompositionMemberInput,
  availability: Availability,
  host: CompositionHost,
  context: CompositionCreateInput,
): CompositionMember {
  if (!isRecord(input)) throw new CompositionError('COMPOSITION_INVALID', 'Member must be an object.', 'members');
  const alias = requireToken(input.alias, 'members.alias', 'host');
  if (!MEMBER_KINDS.includes(input.kind)) {
    throw new CompositionError('COMPOSITION_INVALID', `Unknown member kind ${String(input.kind)}.`, alias);
  }
  const role = (input.role ?? ROLE_FOR_KIND[input.kind]) as CompositionRole;
  if (role !== ROLE_FOR_KIND[input.kind]) {
    throw new CompositionError('COMPOSITION_INVALID', `Member ${alias} must use role ${ROLE_FOR_KIND[input.kind]}.`, alias);
  }
  const material = availability === 'material';
  if (input.kind === 'v5-image') return normalizeV5(alias, input, material);
  if (input.kind === 'v4-pack') return normalizeV4(alias, input, material);
  if (input.kind === 'kar-sidecar') return normalizeKar(alias, input, material, host, context, inputHostBytes(context));
  if (input.kind === 'domain-pack') return normalizeDomain(alias, input, material, context);
  if (input.kind === 'excerpt') return normalizeExcerpt(alias, input, material);
  return normalizeNested(alias, input, material);
}

function normalizeV5(alias: string, input: CompositionMemberInput, material: boolean): V5Member {
  if (input.bytes) {
    const bytes = asBytes(input.bytes, alias);
    const image = mountImage(bytes, alias);
    const member: V5Member = {
      alias,
      kind: 'v5-image',
      role: 'dependency',
      stateRoot: image.stateRoot,
      objectRoot: image.commit.objectRoot,
      commitDigest: image.commitDigest,
      sha256: fileSha256(bytes),
    };
    if (input.knowledgeRoot) member.knowledgeRoot = requireDigest(input.knowledgeRoot, `${alias}.knowledgeRoot`);
    agree(member.stateRoot, input.stateRoot, `${alias}.stateRoot`);
    agree(member.objectRoot, input.objectRoot, `${alias}.objectRoot`);
    agree(member.commitDigest, input.commitDigest, `${alias}.commitDigest`);
    agree(member.sha256, input.sha256, `${alias}.sha256`);
    return member;
  }
  if (material) throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing bytes for ${alias}.`, alias);
  const member: V5Member = {
    alias,
    kind: 'v5-image',
    role: 'dependency',
    stateRoot: requireDigest(input.stateRoot, `${alias}.stateRoot`),
    objectRoot: requireDigest(input.objectRoot, `${alias}.objectRoot`),
    commitDigest: requireDigest(input.commitDigest, `${alias}.commitDigest`),
    sha256: requireDigest(input.sha256, `${alias}.sha256`),
  };
  if (input.knowledgeRoot) member.knowledgeRoot = requireDigest(input.knowledgeRoot, `${alias}.knowledgeRoot`);
  return member;
}

function normalizeV4(alias: string, input: CompositionMemberInput, material: boolean): V4Member {
  if (input.bytes) {
    const bytes = asBytes(input.bytes, alias);
    const inspected = inspectV4(bytes, alias);
    const member: V4Member = {
      alias,
      kind: 'v4-pack',
      role: 'dependency',
      packDigest: requireDigest(inspected.packDigest, `${alias}.packDigest`),
      manifestDigest: requireDigest(inspected.manifestDigest, `${alias}.manifestDigest`),
      sha256: fileSha256(bytes),
    };
    agree(member.packDigest, input.packDigest, `${alias}.packDigest`);
    agree(member.manifestDigest, input.manifestDigest, `${alias}.manifestDigest`);
    agree(member.sha256, input.sha256, `${alias}.sha256`);
    return member;
  }
  if (material) throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing bytes for ${alias}.`, alias);
  return {
    alias,
    kind: 'v4-pack',
    role: 'dependency',
    packDigest: requireDigest(input.packDigest, `${alias}.packDigest`),
    manifestDigest: requireDigest(input.manifestDigest, `${alias}.manifestDigest`),
    sha256: requireDigest(input.sha256, `${alias}.sha256`),
  };
}

function normalizeKar(
  alias: string,
  input: CompositionMemberInput,
  material: boolean,
  host: CompositionHost,
  context: CompositionCreateInput,
  hostBytes: Uint8Array | undefined,
): KarMember {
  const bindsTo = input.bindsTo === 'host' ? 'host' : requireToken(input.bindsTo, `${alias}.bindsTo`);
  if (bindsTo === 'host' && host.kind !== 'v5-image') {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} binds to a host image that is not set.`, alias);
  }
  let semanticRoot = input.semanticRoot;
  let knowledgeRoot = input.knowledgeRoot;
  let sha = input.sha256;
  if (input.bytes) {
    const bytes = asBytes(input.bytes, alias);
    sha = fileSha256(bytes);
    const imageBytes = bindsTo === 'host' ? hostBytes : imageBytesFor(bindsTo, context.members, alias);
    if (imageBytes && context.karBinder) {
      const bound = bindKar(context.karBinder, imageBytes, bytes, alias);
      semanticRoot = bound.semanticRoot;
      knowledgeRoot = bound.knowledgeRoot;
      if (bindsTo === 'host' && host.kind === 'v5-image' && host.knowledgeRoot && host.knowledgeRoot !== knowledgeRoot) {
        throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} knowledgeRoot does not match the host.`, alias);
      }
    }
  } else if (material) {
    throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing bytes for ${alias}.`, alias);
  }
  if (!isDigest(semanticRoot) || !isDigest(knowledgeRoot) || !isDigest(sha)) {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} needs a bound knowledgeRoot, semanticRoot, and sha256.`, alias);
  }
  const imageRoot = knowledgeRootFor(bindsTo, host, context.members);
  if (imageRoot && imageRoot !== knowledgeRoot) {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} knowledgeRoot does not match ${bindsTo}.`, alias);
  }
  if (!imageRoot) {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} binds to ${bindsTo}, which has no knowledgeRoot.`, alias);
  }
  return { alias, kind: 'kar-sidecar', role: 'evidence', bindsTo, semanticRoot, knowledgeRoot, sha256: sha };
}

function normalizeDomain(alias: string, input: CompositionMemberInput, material: boolean, context: CompositionCreateInput): DomainMember {
  let id = input.id;
  let version = input.version;
  let root = input.root;
  let filesRoot = input.filesRoot;
  if (input.files) {
    const files = normalizeFiles(input.files, alias);
    filesRoot = compositionFileSetRoot(files.map((file) => ({ path: file.path, sha256: fileSha256(file.bytes) })));
    if (!context.domainPackRoot) {
      throw new CompositionError('COMPOSITION_DOMAIN_PACK_UNVERIFIED', `${alias} needs a domainPackRoot resolver.`, alias);
    }
    const identity = context.domainPackRoot(files);
    if (!identity) throw new CompositionError('COMPOSITION_DOMAIN_PACK_UNVERIFIED', `${alias} domain pack did not verify.`, alias);
    id = identity.id;
    version = identity.version;
    root = identity.root;
  } else if (material) {
    throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing files for ${alias}.`, alias);
  }
  if (!validPackToken(id) || !validPackToken(version) || !isDigest(root) || !isDigest(filesRoot)) {
    throw new CompositionError('COMPOSITION_INVALID', `${alias} needs id, version, root, and filesRoot.`, alias);
  }
  agree(root, input.root, `${alias}.root`);
  agree(filesRoot, input.filesRoot, `${alias}.filesRoot`);
  if (input.id !== undefined && input.id !== id) throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${alias} id does not match the domain pack.`, alias);
  if (input.version !== undefined && input.version !== version) throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${alias} version does not match the domain pack.`, alias);
  return { alias, kind: 'domain-pack', role: 'vocabulary', id, version, root, filesRoot };
}

function normalizeExcerpt(alias: string, input: CompositionMemberInput, material: boolean): ExcerptMember {
  const inclusion = input.inclusion ?? (material ? 'included' : undefined);
  if (inclusion !== 'included' && inclusion !== 'digest-bound') {
    throw new CompositionError('EXCERPT_INVALID', `${alias} inclusion must be included or digest-bound.`, alias);
  }
  if (material && inclusion !== 'included') {
    throw new CompositionError('EXCERPT_INVALID', `${alias} material excerpt must be included.`, alias);
  }
  return {
    alias,
    kind: 'excerpt',
    role: 'excerpt',
    excerptRoot: requireDigest(input.excerptRoot, `${alias}.excerptRoot`, 'EXCERPT_INVALID'),
    parentStateRoot: requireDigest(input.parentStateRoot, `${alias}.parentStateRoot`, 'EXCERPT_INVALID'),
    parentObjectRoot: requireDigest(input.parentObjectRoot, `${alias}.parentObjectRoot`, 'EXCERPT_INVALID'),
    parentCommitDigest: requireDigest(input.parentCommitDigest, `${alias}.parentCommitDigest`, 'EXCERPT_INVALID'),
    inclusion,
  };
}

function normalizeNested(alias: string, input: CompositionMemberInput, material: boolean): NestedMember {
  if (input.record) {
    const nested = parseCompositionRecord(input.record);
    if (input.compositionRoot && input.compositionRoot !== nested.compositionRoot) {
      throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${alias} compositionRoot does not match the nested record.`, alias);
    }
    return { alias, kind: 'composition', role: 'nested', compositionRoot: nested.compositionRoot };
  }
  if (material && !input.compositionRoot) {
    throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing nested record for ${alias}.`, alias);
  }
  return {
    alias,
    kind: 'composition',
    role: 'nested',
    compositionRoot: requireDigest(input.compositionRoot, `${alias}.compositionRoot`),
  };
}

function normalizePolicy(input: CompositionPolicyInput | undefined, members: CompositionMember[]): CompositionPolicy {
  const policy: CompositionPolicy = {
    default: input?.default ?? 'allow',
    allow: sortEntries(input?.allow ?? []),
    deny: sortEntries(input?.deny ?? []),
  };
  if (policy.default !== 'allow' && policy.default !== 'deny') {
    throw new CompositionError('COMPOSITION_POLICY_INVALID', 'Policy default must be allow or deny.', 'policy.default');
  }
  assertPolicyTargets(policy, members);
  enforcePolicy(policy, members);
  return policy;
}

function parseHost(value: unknown): CompositionHost {
  if (!isRecord(value)) throw new CompositionError('COMPOSITION_INVALID', 'Host must be an object.', 'host');
  if (value.kind === 'none') {
    exactKeys(value, ['kind'], 'host');
    return { kind: 'none' };
  }
  if (value.kind !== 'v5-image') throw new CompositionError('COMPOSITION_INVALID', 'Host kind must be none or v5-image.', 'host.kind');
  exactKeys(value, ['kind', 'stateRoot', 'objectRoot', 'commitDigest', 'knowledgeRoot'], 'host');
  const host: CompositionHost = {
    kind: 'v5-image',
    stateRoot: requireDigest(value.stateRoot, 'host.stateRoot'),
    objectRoot: requireDigest(value.objectRoot, 'host.objectRoot'),
    commitDigest: requireDigest(value.commitDigest, 'host.commitDigest'),
  };
  if (value.knowledgeRoot !== undefined) host.knowledgeRoot = requireDigest(value.knowledgeRoot, 'host.knowledgeRoot');
  return host;
}

function parseMembers(value: unknown): CompositionMember[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > COMPOSITION_MAX_MEMBERS) {
    throw new CompositionError('COMPOSITION_INVALID', `members must contain 1–${COMPOSITION_MAX_MEMBERS} entries.`, 'members');
  }
  const members = value.map((entry, index) => parseMember(entry, `members[${index}]`));
  const sorted = [...members].sort((left, right) => compareUtf16(left.alias, right.alias));
  if (members.some((member, index) => member.alias !== sorted[index].alias)) {
    throw new CompositionError('COMPOSITION_INVALID', 'members must be sorted by alias.', 'members');
  }
  return members;
}

function parseMember(value: unknown, path: string): CompositionMember {
  if (!isRecord(value)) throw new CompositionError('COMPOSITION_INVALID', 'Member must be an object.', path);
  const alias = requireToken(value.alias, `${path}.alias`, 'host');
  const kind = value.kind;
  if (typeof kind !== 'string' || !MEMBER_KINDS.includes(kind as MemberKind)) {
    throw new CompositionError('COMPOSITION_INVALID', `Unknown member kind at ${path}.`, alias);
  }
  const typed = kind as MemberKind;
  if (value.role !== ROLE_FOR_KIND[typed]) {
    throw new CompositionError('COMPOSITION_INVALID', `${alias} must use role ${ROLE_FOR_KIND[typed]}.`, alias);
  }
  if (typed === 'v5-image') {
    exactKeys(value, ['alias', 'kind', 'role', 'stateRoot', 'objectRoot', 'commitDigest', 'sha256', 'knowledgeRoot'], alias);
    const member: V5Member = {
      alias,
      kind: 'v5-image',
      role: 'dependency',
      stateRoot: requireDigest(value.stateRoot, `${alias}.stateRoot`),
      objectRoot: requireDigest(value.objectRoot, `${alias}.objectRoot`),
      commitDigest: requireDigest(value.commitDigest, `${alias}.commitDigest`),
      sha256: requireDigest(value.sha256, `${alias}.sha256`),
    };
    if (value.knowledgeRoot !== undefined) member.knowledgeRoot = requireDigest(value.knowledgeRoot, `${alias}.knowledgeRoot`);
    return member;
  }
  if (typed === 'v4-pack') {
    exactKeys(value, ['alias', 'kind', 'role', 'packDigest', 'manifestDigest', 'sha256'], alias);
    return {
      alias,
      kind: 'v4-pack',
      role: 'dependency',
      packDigest: requireDigest(value.packDigest, `${alias}.packDigest`),
      manifestDigest: requireDigest(value.manifestDigest, `${alias}.manifestDigest`),
      sha256: requireDigest(value.sha256, `${alias}.sha256`),
    };
  }
  if (typed === 'kar-sidecar') {
    exactKeys(value, ['alias', 'kind', 'role', 'bindsTo', 'semanticRoot', 'knowledgeRoot', 'sha256'], alias);
    const bindsTo = value.bindsTo === 'host' ? 'host' : requireToken(value.bindsTo, `${alias}.bindsTo`);
    return {
      alias,
      kind: 'kar-sidecar',
      role: 'evidence',
      bindsTo,
      semanticRoot: requireDigest(value.semanticRoot, `${alias}.semanticRoot`),
      knowledgeRoot: requireDigest(value.knowledgeRoot, `${alias}.knowledgeRoot`),
      sha256: requireDigest(value.sha256, `${alias}.sha256`),
    };
  }
  if (typed === 'domain-pack') {
    exactKeys(value, ['alias', 'kind', 'role', 'id', 'version', 'root', 'filesRoot'], alias);
    if (!validPackToken(value.id) || !validPackToken(value.version)) {
      throw new CompositionError('COMPOSITION_INVALID', `${alias} id and version must be tokens.`, alias);
    }
    return {
      alias,
      kind: 'domain-pack',
      role: 'vocabulary',
      id: value.id,
      version: value.version,
      root: requireDigest(value.root, `${alias}.root`),
      filesRoot: requireDigest(value.filesRoot, `${alias}.filesRoot`),
    };
  }
  if (typed === 'excerpt') {
    exactKeys(value, ['alias', 'kind', 'role', 'excerptRoot', 'parentStateRoot', 'parentObjectRoot', 'parentCommitDigest', 'inclusion'], alias);
    if (value.inclusion !== 'included' && value.inclusion !== 'digest-bound') {
      throw new CompositionError('EXCERPT_INVALID', `${alias} inclusion is invalid.`, alias);
    }
    return {
      alias,
      kind: 'excerpt',
      role: 'excerpt',
      excerptRoot: requireDigest(value.excerptRoot, `${alias}.excerptRoot`, 'EXCERPT_INVALID'),
      parentStateRoot: requireDigest(value.parentStateRoot, `${alias}.parentStateRoot`, 'EXCERPT_INVALID'),
      parentObjectRoot: requireDigest(value.parentObjectRoot, `${alias}.parentObjectRoot`, 'EXCERPT_INVALID'),
      parentCommitDigest: requireDigest(value.parentCommitDigest, `${alias}.parentCommitDigest`, 'EXCERPT_INVALID'),
      inclusion: value.inclusion,
    };
  }
  exactKeys(value, ['alias', 'kind', 'role', 'compositionRoot'], alias);
  return {
    alias,
    kind: 'composition',
    role: 'nested',
    compositionRoot: requireDigest(value.compositionRoot, `${alias}.compositionRoot`),
  };
}

function parsePolicy(value: unknown, members: CompositionMember[]): CompositionPolicy {
  if (!isRecord(value)) throw new CompositionError('COMPOSITION_POLICY_INVALID', 'Policy must be an object.', 'policy');
  exactKeys(value, ['default', 'allow', 'deny'], 'policy', 'COMPOSITION_POLICY_INVALID');
  if (value.default !== 'allow' && value.default !== 'deny') {
    throw new CompositionError('COMPOSITION_POLICY_INVALID', 'Policy default must be allow or deny.', 'policy.default');
  }
  const policy: CompositionPolicy = {
    default: value.default,
    allow: parseEntries(value.allow, 'policy.allow'),
    deny: parseEntries(value.deny, 'policy.deny'),
  };
  const sortedAllow = sortEntries(policy.allow);
  const sortedDeny = sortEntries(policy.deny);
  if (policy.allow.some((entry, index) => entry.alias !== sortedAllow[index].alias || entry.kind !== sortedAllow[index].kind)) {
    throw new CompositionError('COMPOSITION_POLICY_INVALID', 'policy.allow must be sorted.', 'policy.allow');
  }
  if (policy.deny.some((entry, index) => entry.alias !== sortedDeny[index].alias || entry.kind !== sortedDeny[index].kind)) {
    throw new CompositionError('COMPOSITION_POLICY_INVALID', 'policy.deny must be sorted.', 'policy.deny');
  }
  assertPolicyTargets(policy, members);
  enforcePolicy(policy, members);
  return policy;
}

function parseEntries(value: unknown, path: string): PolicyEntry[] {
  if (!Array.isArray(value)) throw new CompositionError('COMPOSITION_POLICY_INVALID', `${path} must be an array.`, path);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new CompositionError('COMPOSITION_POLICY_INVALID', `${path}[${index}] must be an object.`, path);
    exactKeys(entry, ['alias', 'kind'], `${path}[${index}]`, 'COMPOSITION_POLICY_INVALID');
    const alias = requireToken(entry.alias, `${path}[${index}].alias`);
    if (typeof entry.kind !== 'string' || !MEMBER_KINDS.includes(entry.kind as MemberKind)) {
      throw new CompositionError('COMPOSITION_POLICY_INVALID', `${path}[${index}].kind is unknown.`, alias);
    }
    return { alias, kind: entry.kind as MemberKind };
  });
}

function sortEntries(entries: PolicyEntry[]): PolicyEntry[] {
  return [...entries].sort((left, right) => compareUtf16(left.alias, right.alias) || compareUtf16(left.kind, right.kind));
}

function assertPolicyTargets(policy: CompositionPolicy, members: CompositionMember[]): void {
  const known = new Map(members.map((member) => [member.alias, member.kind]));
  for (const entry of [...policy.allow, ...policy.deny]) {
    const kind = known.get(entry.alias);
    if (!kind || kind !== entry.kind) {
      throw new CompositionError('COMPOSITION_POLICY_INVALID', `Policy names ${entry.alias} as ${entry.kind}, which is not a member.`, entry.alias);
    }
  }
}

function enforcePolicy(policy: CompositionPolicy, members: CompositionMember[]): void {
  for (const member of members) {
    const denied = policy.deny.some((entry) => entry.alias === member.alias && entry.kind === member.kind);
    const allowed = policy.allow.some((entry) => entry.alias === member.alias && entry.kind === member.kind);
    if (denied || (policy.default === 'deny' && !allowed)) {
      throw new CompositionError('COMPOSITION_POLICY_DENIED', `Policy denies ${member.alias}.`, member.alias);
    }
  }
}

function rejectDuplicates(host: CompositionHost, members: CompositionMember[]): void {
  const aliases = new Set<string>();
  const identities = new Set<string>();
  for (const member of members) {
    if (aliases.has(member.alias)) throw new CompositionError('COMPOSITION_DUPLICATE', `Duplicate alias ${member.alias}.`, member.alias);
    aliases.add(member.alias);
    const identity = primaryIdentity(member);
    if (identities.has(identity)) throw new CompositionError('COMPOSITION_DUPLICATE', `Duplicate member identity ${identity}.`, member.alias);
    identities.add(identity);
    if (member.kind === 'v5-image' && host.kind === 'v5-image' && member.stateRoot === host.stateRoot) {
      throw new CompositionError('COMPOSITION_DUPLICATE', `${member.alias} repeats the host stateRoot.`, member.alias);
    }
    if (member.kind === 'kar-sidecar') {
      const target = member.bindsTo === 'host' ? host : members.find((item) => item.alias === member.bindsTo);
      if (!target || (member.bindsTo !== 'host' && target.kind !== 'v5-image') || (member.bindsTo === 'host' && host.kind !== 'v5-image')) {
        throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${member.alias} does not bind to a V5 image.`, member.alias);
      }
    }
  }
}

function primaryIdentity(member: CompositionMember): string {
  if (member.kind === 'v5-image') return `v5:${member.stateRoot}`;
  if (member.kind === 'v4-pack') return `v4:${member.packDigest}`;
  if (member.kind === 'kar-sidecar') return `kar:${member.bindsTo}:${member.semanticRoot}`;
  if (member.kind === 'domain-pack') return `domain:${member.root}`;
  if (member.kind === 'excerpt') return `excerpt:${member.excerptRoot}`;
  return `composition:${member.compositionRoot}`;
}

function walk(
  record: CompositionRecord,
  stack: string[],
  seen: Set<CompositionRecord>,
  options: CompositionVerifyOptions,
  requireMaterial: boolean,
): CompositionMemberStatus[] {
  if (stack.length >= COMPOSITION_MAX_DEPTH) {
    throw new CompositionError('COMPOSITION_DEPTH_EXCEEDED', 'Composition nesting is deeper than 8.', 'members');
  }
  if (stack.includes(record.compositionRoot) || seen.has(record)) {
    throw new CompositionError('COMPOSITION_CYCLE', 'Composition records form a cycle.', 'members');
  }
  seen.add(record);
  if (options.hostBytes) checkHostBytes(record.host, options.hostBytes);
  else if (requireMaterial && record.host.kind === 'v5-image') {
    throw new CompositionError('COMPOSITION_MEMBER_MISSING', 'Material composition is missing the host image.', 'host');
  }
  const next = stack.concat(record.compositionRoot);
  const statuses: CompositionMemberStatus[] = [];
  for (const member of record.members) {
    const supplied = options.members?.[member.alias];
    if (supplied) {
      checkMemberMaterial(member, supplied, record, options, next, seen);
      statuses.push({ alias: member.alias, status: 'material' });
    } else if (requireMaterial || member.kind === 'excerpt' && member.inclusion === 'included') {
      throw new CompositionError('COMPOSITION_MEMBER_MISSING', `Missing material for ${member.alias}.`, member.alias);
    } else if (member.kind === 'composition' && options.nested?.[member.compositionRoot]) {
      const child = options.nested[member.compositionRoot];
      checkNested(member, child.record, { ...options, members: child.members, hostBytes: child.hostBytes }, next, seen);
      statuses.push({ alias: member.alias, status: 'material' });
    } else {
      statuses.push({ alias: member.alias, status: 'digest-bound' });
    }
  }
  seen.delete(record);
  return statuses;
}

function checkHostBytes(host: CompositionHost, bytes: Uint8Array): void {
  if (host.kind !== 'v5-image') throw new CompositionError('COMPOSITION_INVALID', 'Host bytes were supplied for an empty host.', 'host');
  const image = mountImage(bytes, 'host');
  if (image.stateRoot !== host.stateRoot || image.commit.objectRoot !== host.objectRoot || image.commitDigest !== host.commitDigest) {
    throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', 'Host image roots do not match the record.', 'host');
  }
}

function checkMemberMaterial(
  member: CompositionMember,
  material: MemberMaterial,
  record: CompositionRecord,
  options: CompositionVerifyOptions,
  stack: string[],
  seen: Set<CompositionRecord>,
): void {
  if ('bytes' in material && member.kind !== 'domain-pack' && member.kind !== 'composition') {
    const bytes = asBytes(material.bytes, member.alias);
    if (member.kind === 'v5-image') {
      const image = mountImage(bytes, member.alias);
      if (fileSha256(bytes) !== member.sha256 || image.stateRoot !== member.stateRoot || image.commit.objectRoot !== member.objectRoot || image.commitDigest !== member.commitDigest) {
        throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${member.alias} image does not match the record.`, member.alias);
      }
      return;
    }
    if (member.kind === 'v4-pack') {
      const inspected = inspectV4(bytes, member.alias);
      if (fileSha256(bytes) !== member.sha256 || inspected.packDigest !== member.packDigest || inspected.manifestDigest !== member.manifestDigest) {
        throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${member.alias} pack does not match the record.`, member.alias);
      }
      return;
    }
    if (member.kind === 'kar-sidecar') {
      if (fileSha256(bytes) !== member.sha256) {
        throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${member.alias} sidecar bytes do not match.`, member.alias);
      }
      const imageBytes = sidecarImageBytes(member, record, options);
      if (!imageBytes || !options.karBinder) {
        throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${member.alias} cannot be bound without its image and a KAR binder.`, member.alias);
      }
      const bound = bindKar(options.karBinder, imageBytes, bytes, member.alias);
      if (bound.semanticRoot !== member.semanticRoot || bound.knowledgeRoot !== member.knowledgeRoot) {
        throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${member.alias} is not bound to its image.`, member.alias);
      }
      return;
    }
    if (member.kind === 'excerpt') {
      const image = mountImage(bytes, member.alias);
      if (image.stateRoot !== member.parentStateRoot || image.commit.objectRoot !== member.parentObjectRoot || image.commitDigest !== member.parentCommitDigest) {
        throw new CompositionError('EXCERPT_INCLUSION_MISMATCH', `${member.alias} parent image does not match.`, member.alias);
      }
      return;
    }
  }
  if ('files' in material && member.kind === 'domain-pack') {
    const files = normalizeFiles(material.files, member.alias);
    const filesRoot = compositionFileSetRoot(files.map((file) => ({ path: file.path, sha256: fileSha256(file.bytes) })));
    if (filesRoot !== member.filesRoot) {
      throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${member.alias} filesRoot does not match.`, member.alias);
    }
    if (!options.domainPackRoot) {
      throw new CompositionError('COMPOSITION_DOMAIN_PACK_UNVERIFIED', `${member.alias} needs a domainPackRoot resolver.`, member.alias);
    }
    const identity = options.domainPackRoot(files);
    if (!identity || identity.id !== member.id || identity.version !== member.version || identity.root !== member.root) {
      throw new CompositionError('COMPOSITION_DOMAIN_PACK_UNVERIFIED', `${member.alias} domain pack identity does not match.`, member.alias);
    }
    return;
  }
  if ('record' in material && member.kind === 'composition') {
    checkNested(member, material.record, { ...options, members: material.members, hostBytes: material.hostBytes, nested: options.nested }, stack, seen);
    return;
  }
  if ('excerpt' in material && member.kind === 'excerpt') {
    const verdict = verifyBoundedExcerpt(material.excerpt, material.parentBytes ? { imageBytes: material.parentBytes } : {});
    if (!verdict.ok) {
      throw new CompositionError(verdict.code, `${member.alias} excerpt did not verify.`, member.alias);
    }
    if (verdict.excerptRoot !== member.excerptRoot) {
      throw new CompositionError('EXCERPT_INCLUSION_MISMATCH', `${member.alias} excerptRoot does not match.`, member.alias);
    }
    return;
  }
  if ('excerptRoot' in material && member.kind === 'excerpt') {
    if (material.excerptRoot !== member.excerptRoot) {
      throw new CompositionError('EXCERPT_INCLUSION_MISMATCH', `${member.alias} excerptRoot does not match.`, member.alias);
    }
    if (material.parentBytes) {
      const image = mountImage(material.parentBytes, member.alias);
      if (image.stateRoot !== member.parentStateRoot || image.commit.objectRoot !== member.parentObjectRoot || image.commitDigest !== member.parentCommitDigest) {
        throw new CompositionError('EXCERPT_INCLUSION_MISMATCH', `${member.alias} parent image does not match.`, member.alias);
      }
    } else if (member.inclusion === 'included') {
      throw new CompositionError('EXCERPT_PARENT_MISSING', `${member.alias} inclusion requires the parent image.`, member.alias);
    }
    return;
  }
  throw new CompositionError('COMPOSITION_INVALID', `Material for ${member.alias} does not match its kind.`, member.alias);
}

function checkNested(
  member: NestedMember,
  childValue: CompositionRecord,
  options: CompositionVerifyOptions,
  stack: string[],
  seen: Set<CompositionRecord>,
): void {
  if (stack.includes(member.compositionRoot)) {
    throw new CompositionError('COMPOSITION_CYCLE', 'Composition records form a cycle.', member.alias);
  }
  const child = parseCompositionRecord(childValue);
  if (stack.includes(child.compositionRoot) || seen.has(childValue)) {
    throw new CompositionError('COMPOSITION_CYCLE', 'Composition records form a cycle.', member.alias);
  }
  if (child.compositionRoot !== member.compositionRoot || compositionRootOf(child) !== member.compositionRoot) {
    throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${member.alias} nested compositionRoot does not match.`, member.alias);
  }
  const nested = options.nested?.[child.compositionRoot];
  walk(child, stack, seen, {
    ...options,
    hostBytes: options.hostBytes,
    members: options.members,
    nested: nested ? { ...options.nested } : options.nested,
  }, options.requireMaterial === true || child.availability === 'material');
}

function sidecarImageBytes(member: KarMember, record: CompositionRecord, options: CompositionVerifyOptions): Uint8Array | undefined {
  if (member.bindsTo === 'host') return options.hostBytes;
  const target = options.members?.[member.bindsTo];
  if (target && 'bytes' in target) return target.bytes;
  const declared = record.members.find((item) => item.alias === member.bindsTo);
  if (!declared) throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${member.alias} binds to a missing image.`, member.alias);
  return undefined;
}

function inputHostBytes(context: CompositionCreateInput): Uint8Array | undefined {
  const host = context.host;
  if (!host || host.kind === 'none' || !host.bytes) return undefined;
  return host.bytes;
}

function imageBytesFor(bindsTo: string, members: CompositionMemberInput[], alias: string): Uint8Array | undefined {
  const target = members.find((member) => member.alias === bindsTo);
  if (!target || target.kind !== 'v5-image') {
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', `${alias} binds to ${bindsTo}, which is not a V5 image.`, alias);
  }
  return target.bytes;
}

function knowledgeRootFor(bindsTo: string, host: CompositionHost, members: CompositionMemberInput[]): Digest | undefined {
  if (bindsTo === 'host') return host.kind === 'v5-image' ? host.knowledgeRoot : undefined;
  const target = members.find((member) => member.alias === bindsTo);
  return target?.knowledgeRoot;
}

function bindKar(binder: (image: Uint8Array, graph: Uint8Array) => KarBinding, image: Uint8Array, graph: Uint8Array, alias: string): KarBinding {
  try {
    const bound = binder(image, graph);
    return {
      knowledgeRoot: requireDigest(bound.knowledgeRoot, `${alias}.knowledgeRoot`, 'COMPOSITION_KAR_UNBOUND'),
      semanticRoot: requireDigest(bound.semanticRoot, `${alias}.semanticRoot`, 'COMPOSITION_KAR_UNBOUND'),
      stateRoot: requireDigest(bound.stateRoot, `${alias}.stateRoot`, 'COMPOSITION_KAR_UNBOUND'),
      objectRoot: requireDigest(bound.objectRoot, `${alias}.objectRoot`, 'COMPOSITION_KAR_UNBOUND'),
      commitDigest: requireDigest(bound.commitDigest, `${alias}.commitDigest`, 'COMPOSITION_KAR_UNBOUND'),
    };
  } catch (error) {
    if (error instanceof CompositionError) throw error;
    throw new CompositionError('COMPOSITION_KAR_UNBOUND', error instanceof Error ? error.message : String(error), alias, error);
  }
}

function mountImage(bytes: Uint8Array, path: string): KnowledgeImageV5 {
  try {
    return mountKnowledgeImageV5(bytes);
  } catch (error) {
    throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', error instanceof Error ? error.message : String(error), path, error);
  }
}

function inspectV4(bytes: Uint8Array, path: string): { packDigest: string; manifestDigest: string } {
  try {
    return inspectPackV4(copyBuffer(bytes));
  } catch (error) {
    throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', error instanceof Error ? error.message : String(error), path, error);
  }
}

function normalizeFiles(files: { path: string; bytes: Uint8Array }[], alias: string): { path: string; bytes: Uint8Array }[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > COMPOSITION_MAX_FILES) {
    throw new CompositionError('COMPOSITION_INVALID', `${alias} must contain 1–${COMPOSITION_MAX_FILES} files.`, alias);
  }
  const seen = new Set<string>();
  const rows = files.map((file) => {
    if (!validRelativePath(file.path)) throw new CompositionError('COMPOSITION_INVALID', `${alias} has an invalid file path.`, alias);
    if (seen.has(file.path)) throw new CompositionError('COMPOSITION_DUPLICATE', `${alias} repeats ${file.path}.`, alias);
    seen.add(file.path);
    return { path: file.path, bytes: asBytes(file.bytes, `${alias}:${file.path}`) };
  });
  rows.sort((left, right) => compareUtf16(left.path, right.path));
  return rows;
}

function validPackToken(value: unknown): value is string {
  return typeof value === 'string' && requireTokenOrFalse(value);
}

function requireTokenOrFalse(value: string): boolean {
  try {
    requireToken(value, 'token');
    return true;
  } catch {
    return false;
  }
}

function agree(actual: string, claimed: string | undefined, path: string): void {
  if (claimed !== undefined && claimed !== actual) {
    throw new CompositionError('COMPOSITION_DIGEST_MISMATCH', `${path} does not match the supplied bytes.`, path);
  }
}
