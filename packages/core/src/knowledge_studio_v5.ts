import {
  canonicalCbor,
  digestDomain,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';
import {
  inspectKnowledgeRuntimeV5,
  type KnowledgeRuntimeDiagnosticsInputV1,
  type KnowledgeRuntimeDiagnosticsV1,
} from './knowledge_runtime_diagnostics_v5.js';

export type KnowledgeStudioManagementInputV1 =
  KnowledgeRuntimeDiagnosticsInputV1;

export type KnowledgeStudioManagementV1 = {
  version: 1;
  surface: 'studio-management';
  valid: true;
  readOnly: true;
  diagnostics: KnowledgeRuntimeDiagnosticsV1;
  capabilities: {
    inspectImage: true;
    verifyImage: true;
    inspectQueryIndex: boolean;
    inspectQueryHistory: boolean;
    inspectRun: boolean;
    inspectReplay: boolean;
    mutateImage: false;
  };
  managementRoot: Digest;
};

export function inspectKnowledgeStudioManagementV5(
  input: KnowledgeStudioManagementInputV1
): KnowledgeStudioManagementV1 {
  const diagnostics = inspectKnowledgeRuntimeV5(input);
  const body: Omit<KnowledgeStudioManagementV1, 'managementRoot'> = {
    version: 1,
    surface: 'studio-management',
    valid: true,
    readOnly: true,
    diagnostics,
    capabilities: {
      inspectImage: true,
      verifyImage: true,
      inspectQueryIndex: input.queryIndex !== undefined,
      inspectQueryHistory: input.queryHistory !== undefined,
      inspectRun: input.run !== undefined,
      inspectReplay: input.replayState !== undefined,
      mutateImage: false,
    },
  };
  return { ...body, managementRoot: managementRoot(body) };
}

export function verifyKnowledgeStudioManagementV5(
  input: KnowledgeStudioManagementInputV1,
  snapshot: KnowledgeStudioManagementV1
): void {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    snapshot.surface !== 'studio-management' ||
    snapshot.valid !== true ||
    snapshot.readOnly !== true
  ) {
    throw new Error('Malformed V5 Studio management snapshot.');
  }
  const expected = inspectKnowledgeStudioManagementV5(input);
  if (
    managementRoot(snapshot) !== snapshot.managementRoot ||
    encodeStudioManagement(expected) !== encodeStudioManagement(snapshot)
  ) {
    throw new Error('V5 Studio management root mismatch.');
  }
}

function managementRoot(
  snapshot:
    | Omit<KnowledgeStudioManagementV1, 'managementRoot'>
    | KnowledgeStudioManagementV1
): Digest {
  const { managementRoot: _ignored, ...body } =
    snapshot as KnowledgeStudioManagementV1;
  return digestDomain(
    'studio-management',
    canonicalCbor(body as unknown as CborValue)
  );
}

function encodeStudioManagement(snapshot: KnowledgeStudioManagementV1): string {
  return Array.from(canonicalCbor(snapshot as unknown as CborValue), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
