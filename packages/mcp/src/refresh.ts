import { stat } from 'node:fs/promises';
import {
  KnoloPluginError,
  type KnoloOpenClawService,
  type KnoloPluginConfig,
} from '@knolo/tools';
import { knoloPluginConfig, type KnoloMcpConfig } from './config.js';
import { pinConfiguredGraphs, type PinnedKarGraph } from './graphs.js';

export type ImageRefresh = () => Promise<void>;

type FileStamp = {
  path: string;
  size: bigint;
  mtimeNs: bigint;
};

type LoadedFiles = {
  config: FileStamp;
  images: readonly FileStamp[];
  graphs: readonly FileStamp[];
};

export async function createImageRefresh(options: {
  configPath: string;
  agentId: string;
  loadConfig: () => Promise<KnoloMcpConfig>;
  service: KnoloOpenClawService;
  graphs: Map<string, PinnedKarGraph>;
  pluginConfig: KnoloPluginConfig;
  graphPaths: readonly string[];
}): Promise<ImageRefresh> {
  // Stamps move only after the new files match the pins in the config.
  // A rejected reload leaves the previous image loaded and unserved.
  let loaded: LoadedFiles = {
    config: await stampFile(options.configPath),
    images: options.service.mountedFiles(),
    graphs: await stampFiles(options.graphPaths),
  };
  let tail: Promise<void> = Promise.resolve();

  const refreshOnce = async (): Promise<void> => {
    if (
      !(await filesDrifted([loaded.config])) &&
      !(await filesDrifted(loaded.images)) &&
      !(await filesDrifted(loaded.graphs))
    ) {
      return;
    }
    const config = await options.loadConfig();
    await options.service.reload({
      ...options.pluginConfig,
      mounts: knoloPluginConfig(config).mounts,
    });
    const pinned = await pinConfiguredGraphs(
      config,
      options.service,
      options.agentId
    );
    const images = options.service.mountedFiles();
    const graphs = await stampFiles(karPaths(config));
    const configStamp = await stampFile(options.configPath);
    options.graphs.clear();
    for (const [id, graph] of pinned) options.graphs.set(id, graph);
    loaded = { config: configStamp, images, graphs };
  };

  return () => {
    const run = tail.then(refreshOnce);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

function karPaths(config: KnoloMcpConfig): string[] {
  return config.mounts.flatMap((mount) =>
    mount.kar ? [mount.kar.graphPath] : []
  );
}

async function filesDrifted(files: readonly FileStamp[]): Promise<boolean> {
  for (const file of files) {
    try {
      const metadata = await stat(file.path, { bigint: true });
      if (
        !metadata.isFile() ||
        metadata.size !== file.size ||
        metadata.mtimeNs !== file.mtimeNs
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

async function stampFile(filePath: string): Promise<FileStamp> {
  const [stamp] = await stampFiles([filePath]);
  return stamp;
}

async function stampFiles(paths: readonly string[]): Promise<FileStamp[]> {
  const stamps: FileStamp[] = [];
  for (const filePath of paths) {
    try {
      const metadata = await stat(filePath, { bigint: true });
      if (!metadata.isFile()) {
        throw new Error('not a file');
      }
      stamps.push({
        path: filePath,
        size: metadata.size,
        mtimeNs: metadata.mtimeNs,
      });
    } catch (error) {
      throw new KnoloPluginError(
        'IMAGE_UNAVAILABLE',
        `Could not stat ${filePath}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }
  return stamps;
}
