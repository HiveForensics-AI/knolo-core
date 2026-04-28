import { describe, expect, it } from 'vitest';

import {
  IC_REPLICA_HOST,
  LOCAL_REPLICA_HOST,
  isLocalPage,
  resolveCanisterId,
  resolveNetwork,
  resolveReplicaHost,
} from './canisterConfig';

describe('canister config helpers', () => {
  it('prefers an explicit canister id', () => {
    expect(resolveCanisterId('  aaaaa-aa  ', 'bbbbb-bb')).toBe('aaaaa-aa');
  });

  it('falls back to the dfx-derived canister id', () => {
    expect(resolveCanisterId(undefined, ' bkyz2-fmaaa-aaaaa-qaaaq-cai ')).toBe(
      'bkyz2-fmaaa-aaaaa-qaaaq-cai'
    );
  });

  it('detects local pages and local replica defaults', () => {
    expect(isLocalPage('localhost')).toBe(true);
    expect(resolveNetwork(undefined, '127.0.0.1')).toBe('local');
    expect(resolveReplicaHost('localhost', undefined)).toBe(LOCAL_REPLICA_HOST);
  });

  it('uses ic defaults away from localhost', () => {
    expect(isLocalPage('knolo.example')).toBe(false);
    expect(resolveNetwork(undefined, 'knolo.example')).toBe('ic');
    expect(resolveReplicaHost('knolo.example', undefined)).toBe(IC_REPLICA_HOST);
  });
});
