/// <reference types="vitest/config" />

import fs from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

type CanisterIdsFile = {
  knolo_knowledge?: Record<string, string | undefined>;
};

function readCanisterIds(exampleRoot: string): CanisterIdsFile | undefined {
  const canisterIdsPath = path.join(exampleRoot, '.dfx', 'local', 'canister_ids.json');
  if (!fs.existsSync(canisterIdsPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(canisterIdsPath, 'utf8');
  return JSON.parse(raw) as CanisterIdsFile;
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function pickNetwork(env: Record<string, string>): string {
  return trimValue(env.VITE_DFX_NETWORK) ?? trimValue(env.DFX_NETWORK) ?? 'local';
}

function pickCanisterId(
  env: Record<string, string>,
  canisterIds: CanisterIdsFile | undefined,
  network: string
): string | undefined {
  return (
    trimValue(env.VITE_KNOLO_CANISTER_ID) ??
    trimValue(canisterIds?.knolo_knowledge?.[network]) ??
    trimValue(canisterIds?.knolo_knowledge?.local)
  );
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const exampleRoot = path.resolve(__dirname, '..');
  const network = pickNetwork(env);
  const canisterId = pickCanisterId(env, readCanisterIds(exampleRoot), network);

  return {
    plugins: [react()],
    define: {
      __KNOLO_CANISTER_ID__: canisterId ? JSON.stringify(canisterId) : 'undefined',
      __KNOLO_DFX_NETWORK__: JSON.stringify(network),
    },
    server: {
      fs: {
        allow: [exampleRoot],
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
