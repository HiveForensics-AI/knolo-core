import { runConfiguredRebuild } from './auto-rebuild.js';

type RebuildSpec = Parameters<typeof runConfiguredRebuild>[0];

// Tool calls that arrive while a rebuild is running wait for that run
// instead of starting another process that writes the same image.
export function createRebuildRunner(): (spec: RebuildSpec) => Promise<void> {
  let running: Promise<void> | undefined;
  return (spec) => {
    if (!running) {
      running = runConfiguredRebuild(spec).finally(() => {
        running = undefined;
      });
    }
    return running;
  };
}
