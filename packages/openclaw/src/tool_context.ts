import { KnoloPluginError, type KnoloCaller } from './index.js';

export type KnoloToolContext = {
  memoryAudience?: {
    agentId?: unknown;
    sessionId?: unknown;
  };
  assertInvocationCurrent?: () => void;
  assertMemoryAudienceCurrent?: () => void;
};

/**
 * A factory receives the host-resolved audience. Deliberately do not fall back
 * to caller-provided tool arguments or a declarative execution context.
 */
export function callerFromToolContext(
  context: KnoloToolContext
): KnoloCaller | undefined {
  const audience = context.memoryAudience;
  if (!audience || typeof audience.agentId !== 'string' || !audience.agentId) {
    return undefined;
  }
  return {
    agentId: audience.agentId,
    ...(typeof audience.sessionId === 'string'
      ? { sessionId: audience.sessionId }
      : {}),
  };
}

/**
 * The factory context can become stale while Knolo performs I/O. Check it
 * before the operation and again immediately before its result is released.
 */
export async function executeWithCurrentToolContext<T>(
  context: KnoloToolContext,
  operation: () => Promise<T>
): Promise<T> {
  assertToolContextCurrent(context);
  const result = await operation();
  assertToolContextCurrent(context);
  return result;
}

export function assertToolContextCurrent(context: KnoloToolContext): void {
  if (typeof context.assertInvocationCurrent !== 'function') {
    throw new KnoloPluginError(
      'ACCESS_DENIED',
      'OpenClaw did not provide current invocation authority.'
    );
  }
  context.assertInvocationCurrent();
  context.assertMemoryAudienceCurrent?.();
}
