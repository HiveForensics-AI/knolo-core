import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createKarSession, KarError, type KarSession } from '@knolo/core/kar';
import { KnoloPluginError, type KnoloOpenClawService } from '@knolo/tools';
import type { KnoloMcpConfig } from './config.js';

export type PinnedKarGraph = {
  mountId: string;
  graph: unknown;
  graphSha256: string;
  session: KarSession;
};

export async function pinConfiguredGraphs(
  config: KnoloMcpConfig,
  service: KnoloOpenClawService
): Promise<Map<string, PinnedKarGraph>> {
  const pinned = new Map<string, PinnedKarGraph>();
  for (const mount of config.mounts) {
    if (!mount.kar) continue;
    const authorized = service.readAuthorizedMount(mount.id, {
      agentId: config.agentId,
    });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(mount.kar.graphPath));
    } catch (error) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `Could not read KAR graph for ${mount.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
    const graphSha256 = createHash('sha256').update(bytes).digest('hex');
    if (graphSha256 !== mount.kar.graphSha256) {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `KAR graph for ${mount.id} does not match its SHA-256 pin.`
      );
    }
    let graph: unknown;
    try {
      graph = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `KAR graph for ${mount.id} is not valid JSON.`
      );
    }
    try {
      const session = createKarSession({ image: authorized.image, graph });
      pinned.set(mount.id, {
        mountId: mount.id,
        graph,
        graphSha256,
        session,
      });
    } catch (error) {
      const detail =
        error instanceof KarError || error instanceof Error
          ? error.message
          : 'KAR graph is not bound.';
      throw new KnoloPluginError(
        'IMAGE_INVALID',
        `KAR graph for ${mount.id} is not bound to the pinned image: ${detail}`
      );
    }
  }
  return pinned;
}
