import type { Digest } from './knowledge_image_v5.js';

export type KnowledgeAuthorizedOperationV1 =
  'commit' | 'merge' | 'policy' | 'authority' | 'sync';

export type KnowledgeAuthorizedOperationRequestV1 = {
  operation: KnowledgeAuthorizedOperationV1;
  actor: string;
  stateRoot?: Digest;
  planRoot?: Digest;
  details?: Readonly<Record<string, string>>;
};

export type KnowledgeAuthorizedOperationAuditEventV1 =
  KnowledgeAuthorizedOperationRequestV1 & {
    allowed: boolean;
  };

export type KnowledgeAuthorizedOperationBoundaryV1 = {
  authorize(request: KnowledgeAuthorizedOperationRequestV1): boolean;
  audit(event: KnowledgeAuthorizedOperationAuditEventV1): void;
};

/**
 * Gate one state-changing V5 operation at the host boundary.
 *
 * The core records the decision and only invokes the supplied mutation after
 * authorization. Policy and authority administration stay host-provided
 * handlers; this function gives those handlers the same auditable gate as
 * commits, merges, and synchronization.
 */
export function executeKnowledgeAuthorizedOperationV5<T>(
  boundary: KnowledgeAuthorizedOperationBoundaryV1,
  request: KnowledgeAuthorizedOperationRequestV1,
  mutation: () => T
): T {
  validateRequest(request);
  const allowed = boundary.authorize({
    ...request,
    details: copyDetails(request.details),
  });
  boundary.audit({
    ...request,
    details: copyDetails(request.details),
    allowed,
  });
  if (!allowed) {
    throw new Error(`V5 ${request.operation} operation authorization denied.`);
  }
  return mutation();
}

function validateRequest(request: KnowledgeAuthorizedOperationRequestV1): void {
  if (!request || typeof request !== 'object') {
    throw new Error('V5 authorized operation request is required.');
  }
  if (!request.actor || typeof request.actor !== 'string') {
    throw new Error('V5 authorized operation actor is required.');
  }
  if (
    !['commit', 'merge', 'policy', 'authority', 'sync'].includes(
      request.operation
    )
  ) {
    throw new Error('V5 authorized operation kind is invalid.');
  }
  if (request.details !== undefined) {
    if (
      typeof request.details !== 'object' ||
      request.details === null ||
      Array.isArray(request.details)
    ) {
      throw new Error('V5 authorized operation details must be a record.');
    }
    for (const [key, value] of Object.entries(request.details)) {
      if (!key || typeof value !== 'string') {
        throw new Error(
          'V5 authorized operation details must contain string values.'
        );
      }
    }
  }
}

function copyDetails(
  details: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined {
  return details === undefined ? undefined : { ...details };
}
