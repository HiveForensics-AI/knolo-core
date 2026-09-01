import {
  executeKnowledgeSyncHostDeploymentV5,
  type KnowledgeSyncHostDeploymentOptionsV1,
  type KnowledgeSyncHostDeploymentResultV1,
  type KnowledgeSyncHostImageTransferV1,
  type KnowledgeSyncHostImageTransportV1,
  type KnowledgeSyncPeerDiscoveryInputV1,
  type KnowledgeSyncPeerDiscoveryV1,
  type KnowledgeSyncPeerV1,
  type KnowledgeSyncTransferCheckpointV1,
} from './knowledge_sync_host_v5.js';
import { DurableKnowledgeImageStoreV5 } from './knowledge_store_v5.node.js';
import {
  executeKnowledgeAuthorizedOperationV5,
  type KnowledgeAuthorizedOperationBoundaryV1,
} from './knowledge_authorized_operations_v5.js';
import type { Digest } from './knowledge_image_v5.js';

export type InMemoryKnowledgeSyncPeerHandlerV5 = (
  requestBytes: Uint8Array,
  checkpoint?: KnowledgeSyncTransferCheckpointV1
) =>
  KnowledgeSyncHostImageTransferV1 | Promise<KnowledgeSyncHostImageTransferV1>;

/**
 * A deterministic reference adapter for host integration tests and local
 * development. It models discovery and byte transfer without sockets,
 * credentials, or deployment state.
 */
export class InMemoryKnowledgeSyncHostAdapterV5
  implements KnowledgeSyncPeerDiscoveryV1, KnowledgeSyncHostImageTransportV1
{
  private readonly handlers = new Map<
    string,
    InMemoryKnowledgeSyncPeerHandlerV5
  >();

  constructor(
    peers: Array<{
      peerId: string;
      handler: InMemoryKnowledgeSyncPeerHandlerV5;
    }> = []
  ) {
    for (const peer of peers) this.addPeer(peer.peerId, peer.handler);
  }

  addPeer(peerId: string, handler: InMemoryKnowledgeSyncPeerHandlerV5): this {
    if (!peerId || this.handlers.has(peerId)) {
      throw new Error(
        `V5 in-memory sync peer ID is invalid or already registered: ${peerId}.`
      );
    }
    this.handlers.set(peerId, handler);
    return this;
  }

  discover(_input: KnowledgeSyncPeerDiscoveryInputV1): KnowledgeSyncPeerV1[] {
    return [...this.handlers.keys()].sort().map((peerId) => ({ peerId }));
  }

  async requestImage(
    peer: KnowledgeSyncPeerV1,
    requestBytes: Uint8Array,
    checkpoint?: KnowledgeSyncTransferCheckpointV1
  ): Promise<KnowledgeSyncHostImageTransferV1> {
    const handler = this.handlers.get(peer.peerId);
    if (!handler)
      throw new Error(`V5 in-memory sync peer is unavailable: ${peer.peerId}.`);
    return handler(requestBytes.slice(), checkpoint);
  }
}

export type KnowledgeSyncHostFastForwardOptionsV1 = {
  deployment: KnowledgeSyncHostDeploymentOptionsV1;
  store: DurableKnowledgeImageStoreV5;
  actor: string;
  authorization: KnowledgeAuthorizedOperationBoundaryV1;
  localKeyringRoot?: Digest;
  remoteKeyringRoot?: Digest;
};

export type KnowledgeSyncHostApplyResultV1 = {
  deployment: KnowledgeSyncHostDeploymentResultV1;
  beforeStateRoot: Digest;
  afterStateRoot: Digest;
  planRoot: Digest;
};

/**
 * Run the host deployment coordinator, then apply only a verified direct
 * remote-ahead image through the same explicit authorization boundary used by
 * other V5 mutations.
 */
export async function executeKnowledgeSyncHostFastForwardV5(
  options: KnowledgeSyncHostFastForwardOptionsV1
): Promise<KnowledgeSyncHostApplyResultV1> {
  const deployment = await executeKnowledgeSyncHostDeploymentV5(
    options.deployment
  );
  const beforeStateRoot = options.store.stateRoot;
  const plan = options.store.syncPlan(
    deployment.image,
    options.localKeyringRoot,
    options.remoteKeyringRoot
  );
  const applied = executeKnowledgeAuthorizedOperationV5(
    options.authorization,
    {
      operation: 'sync',
      actor: options.actor,
      stateRoot: beforeStateRoot,
      planRoot: plan.planRoot,
      details: {
        peerId: deployment.peer.peerId,
        requestId: options.deployment.request.requestId,
      },
    },
    () =>
      options.store.fastForward(
        deployment.image,
        options.localKeyringRoot,
        options.remoteKeyringRoot
      )
  );
  return {
    deployment,
    beforeStateRoot,
    afterStateRoot: applied.stateRoot,
    planRoot: plan.planRoot,
  };
}
