import {
  exchangeKnowledgeSyncImageOverTransportV5,
  type KnowledgeSyncExchangeAsyncVerificationOptionsV1,
  type KnowledgeSyncImageTransportExchangeResultV1,
} from './knowledge_sync_exchange_v5.js';
import type { Digest } from './knowledge_image_v5.js';
import type { KnowledgeSyncRequestV1 } from './knowledge_sync_protocol_v5.js';

export type KnowledgeSyncPeerV1 = {
  peerId: string;
};

export type KnowledgeSyncPeerDiscoveryInputV1 = {
  requestId: Digest;
  sender: string;
  summaryRoot: Digest;
};

export type KnowledgeSyncPeerDiscoveryV1 = {
  discover(
    input: KnowledgeSyncPeerDiscoveryInputV1
  ): KnowledgeSyncPeerV1[] | Promise<KnowledgeSyncPeerV1[]>;
};

export type KnowledgeSyncTransferCheckpointV1 = {
  requestId: Digest;
  offset: number;
  totalBytes?: number;
};

export type KnowledgeSyncTransferCheckpointKeyV1 = {
  requestId: Digest;
  peerId: string;
};

export type KnowledgeSyncTransferCheckpointStoreV1 = {
  load(
    key: KnowledgeSyncTransferCheckpointKeyV1
  ):
    | KnowledgeSyncTransferCheckpointV1
    | undefined
    | Promise<KnowledgeSyncTransferCheckpointV1 | undefined>;
  save(
    key: KnowledgeSyncTransferCheckpointKeyV1,
    checkpoint: KnowledgeSyncTransferCheckpointV1
  ): void | Promise<void>;
};

export type KnowledgeSyncHostImageTransferV1 = {
  responseBytes: ArrayBufferLike | Uint8Array;
  imageBytes: ArrayBufferLike | Uint8Array;
};

export type KnowledgeSyncHostImageTransportV1 = {
  requestImage(
    peer: KnowledgeSyncPeerV1,
    requestBytes: Uint8Array,
    checkpoint?: KnowledgeSyncTransferCheckpointV1
  ):
    | KnowledgeSyncHostImageTransferV1
    | Promise<KnowledgeSyncHostImageTransferV1>;
};

export type KnowledgeSyncHostMonitorEventV1 =
  | {
      kind: 'deployment.started';
      requestId: Digest;
      maxAttempts: number;
    }
  | {
      kind: 'peer.discovery';
      requestId: Digest;
      peerCount: number;
      peerId: string;
    }
  | {
      kind: 'peer.discovery.failed';
      requestId: Digest;
      error: string;
    }
  | {
      kind: 'transfer.attempt';
      requestId: Digest;
      peerId: string;
      attempt: number;
      resumeOffset: number;
    }
  | {
      kind: 'transfer.retry';
      requestId: Digest;
      peerId: string;
      attempt: number;
      resumeOffset: number;
      error: string;
    }
  | {
      kind: 'deployment.succeeded';
      requestId: Digest;
      peerId: string;
      attempts: number;
      bytes: number;
    }
  | {
      kind: 'deployment.expired';
      requestId: Digest;
      peerId: string;
      attempt: number;
    }
  | {
      kind: 'deployment.replayed';
      requestId: Digest;
      peerId: string;
      attempt: number;
    }
  | {
      kind: 'deployment.failed';
      requestId: Digest;
      peerId: string;
      attempts: number;
      error: string;
    };

export type KnowledgeSyncHostMonitorV1 = (
  event: KnowledgeSyncHostMonitorEventV1
) => void | Promise<void>;

export type KnowledgeSyncHostDeploymentOptionsV1 = {
  request: KnowledgeSyncRequestV1;
  discovery: KnowledgeSyncPeerDiscoveryV1;
  transport: KnowledgeSyncHostImageTransportV1;
  verification: Omit<KnowledgeSyncExchangeAsyncVerificationOptionsV1, 'now'>;
  now: number | (() => number);
  peerId?: string;
  maxAttempts?: number;
  checkpointStore?: KnowledgeSyncTransferCheckpointStoreV1;
  monitor?: KnowledgeSyncHostMonitorV1;
};

export type KnowledgeSyncHostDeploymentResultV1 =
  KnowledgeSyncImageTransportExchangeResultV1 & {
    peer: KnowledgeSyncPeerV1;
    attempts: number;
    checkpoint: KnowledgeSyncTransferCheckpointV1;
  };

/** A bounded transfer error that lets a host preserve its last good checkpoint. */
export class KnowledgeSyncTransferErrorV1 extends Error {
  readonly checkpoint?: KnowledgeSyncTransferCheckpointV1;

  constructor(message: string, checkpoint?: KnowledgeSyncTransferCheckpointV1) {
    super(message);
    this.name = 'KnowledgeSyncTransferErrorV1';
    this.checkpoint = checkpoint;
  }
}

/**
 * Discover one explicitly selected peer and carry one verified V5 image
 * exchange through a host-owned, retryable transport.
 *
 * This coordinator does not open sockets, resolve credentials, choose an
 * endpoint, or persist deployment state. Those concerns stay in the supplied
 * discovery, transport, and monitoring adapters.
 */
export async function executeKnowledgeSyncHostDeploymentV5(
  options: KnowledgeSyncHostDeploymentOptionsV1
): Promise<KnowledgeSyncHostDeploymentResultV1> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(
      'V5 host deployment attempt limit must be a positive safe integer.'
    );
  }

  await options.monitor?.({
    kind: 'deployment.started',
    requestId: options.request.requestId,
    maxAttempts,
  });

  let peers: KnowledgeSyncPeerV1[];
  let peer: KnowledgeSyncPeerV1;
  try {
    peers = await options.discovery.discover({
      requestId: options.request.requestId,
      sender: options.request.sender,
      summaryRoot: options.request.summary.summaryRoot,
    });
    peer = selectPeer(peers, options.peerId);
  } catch (error) {
    await options.monitor?.({
      kind: 'peer.discovery.failed',
      requestId: options.request.requestId,
      error: errorMessage(error),
    });
    throw error;
  }
  await options.monitor?.({
    kind: 'peer.discovery',
    requestId: options.request.requestId,
    peerCount: peers.length,
    peerId: peer.peerId,
  });

  let checkpoint = await options.checkpointStore?.load({
    requestId: options.request.requestId,
    peerId: peer.peerId,
  });
  if (checkpoint) {
    checkpoint = validateCheckpoint(checkpoint, options.request.requestId);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await options.monitor?.({
      kind: 'transfer.attempt',
      requestId: options.request.requestId,
      peerId: peer.peerId,
      attempt,
      resumeOffset: checkpoint?.offset ?? 0,
    });

    try {
      const exchanged = await exchangeKnowledgeSyncImageOverTransportV5(
        options.request,
        {
          ...options.verification,
          now: typeof options.now === 'function' ? options.now() : options.now,
          transport: {
            requestImage: (requestBytes) =>
              options.transport.requestImage(peer, requestBytes, checkpoint),
          },
        }
      );
      const nextCheckpoint = {
        requestId: options.request.requestId,
        offset: exchanged.imageBytes.length,
        totalBytes: exchanged.imageBytes.length,
      } satisfies KnowledgeSyncTransferCheckpointV1;
      await options.checkpointStore?.save(
        { requestId: options.request.requestId, peerId: peer.peerId },
        nextCheckpoint
      );
      await options.monitor?.({
        kind: 'deployment.succeeded',
        requestId: options.request.requestId,
        peerId: peer.peerId,
        attempts: attempt,
        bytes: exchanged.imageBytes.length,
      });
      return {
        ...exchanged,
        peer,
        attempts: attempt,
        checkpoint: nextCheckpoint,
      };
    } catch (error) {
      lastError = error;
      if (isExpiredError(error)) {
        await options.monitor?.({
          kind: 'deployment.expired',
          requestId: options.request.requestId,
          peerId: peer.peerId,
          attempt,
        });
        throw error;
      }
      if (isReplayError(error)) {
        await options.monitor?.({
          kind: 'deployment.replayed',
          requestId: options.request.requestId,
          peerId: peer.peerId,
          attempt,
        });
        throw error;
      }
      if (error instanceof KnowledgeSyncTransferErrorV1 && error.checkpoint) {
        checkpoint = validateCheckpoint(
          error.checkpoint,
          options.request.requestId
        );
        await options.checkpointStore?.save(
          { requestId: options.request.requestId, peerId: peer.peerId },
          checkpoint
        );
      }
      if (attempt < maxAttempts) {
        await options.monitor?.({
          kind: 'transfer.retry',
          requestId: options.request.requestId,
          peerId: peer.peerId,
          attempt,
          resumeOffset: checkpoint?.offset ?? 0,
          error: errorMessage(error),
        });
        continue;
      }
      await options.monitor?.({
        kind: 'deployment.failed',
        requestId: options.request.requestId,
        peerId: peer.peerId,
        attempts: attempt,
        error: errorMessage(error),
      });
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('V5 host deployment failed without an error.');
}

function selectPeer(
  peers: KnowledgeSyncPeerV1[],
  peerId?: string
): KnowledgeSyncPeerV1 {
  if (!Array.isArray(peers) || peers.some((peer) => !peer?.peerId)) {
    throw new Error('V5 host peer discovery returned malformed peers.');
  }
  const unique = [
    ...new Map(peers.map((peer) => [peer.peerId, peer])).values(),
  ].sort((left, right) => left.peerId.localeCompare(right.peerId));
  if (peerId) {
    const selected = unique.find((peer) => peer.peerId === peerId);
    if (!selected)
      throw new Error(`V5 host peer was not discovered: ${peerId}.`);
    return selected;
  }
  if (unique.length !== 1) {
    throw new Error(
      'V5 host deployment requires an explicit peer when discovery is not singular.'
    );
  }
  return unique[0];
}

function validateCheckpoint(
  checkpoint: KnowledgeSyncTransferCheckpointV1,
  requestId: Digest
): KnowledgeSyncTransferCheckpointV1 {
  if (
    checkpoint.requestId !== requestId ||
    !Number.isSafeInteger(checkpoint.offset) ||
    checkpoint.offset < 0 ||
    (checkpoint.totalBytes !== undefined &&
      (!Number.isSafeInteger(checkpoint.totalBytes) ||
        checkpoint.totalBytes < checkpoint.offset))
  ) {
    throw new Error('Malformed V5 host transfer checkpoint.');
  }
  return { ...checkpoint };
}

function isExpiredError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('validity window');
}

function isReplayError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('replay');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
