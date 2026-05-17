import { Actor, HttpAgent } from '@dfinity/agent';
import type { ActorMethod, ActorSubclass } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import type { InterfaceFactory } from '@dfinity/candid/lib/cjs/idl';

import { resolveCanisterId, resolveNetwork, resolveReplicaHost } from './canisterConfig';

export type Opt<T> = [] | [T];

export interface HealthDto {
  ok: boolean;
  message: string;
}

export interface HitDto {
  block_id: bigint;
  score: number;
  text: string;
  source: Opt<string>;
  namespace: Opt<string>;
}

export interface PackInfo {
  loaded: boolean;
  label: Opt<string>;
  version: Opt<number>;
  docs: Opt<bigint>;
  blocks: Opt<bigint>;
  terms: Opt<bigint>;
}

export interface KnoloService {
  clear_pack: ActorMethod<[], HealthDto>;
  health: ActorMethod<[], HealthDto>;
  pack_info: ActorMethod<[], PackInfo>;
  search: ActorMethod<[string, number], Array<HitDto>>;
  set_pack: ActorMethod<[Uint8Array | number[], string], HealthDto>;
}

export const idlFactory: InterfaceFactory = ({ IDL: idl }) => {
  const HealthDto = idl.Record({ ok: idl.Bool, message: idl.Text });
  const PackInfo = idl.Record({
    terms: idl.Opt(idl.Nat64),
    docs: idl.Opt(idl.Nat64),
    loaded: idl.Bool,
    label: idl.Opt(idl.Text),
    version: idl.Opt(idl.Nat32),
    blocks: idl.Opt(idl.Nat64),
  });
  const HitDto = idl.Record({
    block_id: idl.Nat64,
    source: idl.Opt(idl.Text),
    text: idl.Text,
    score: idl.Float64,
    namespace: idl.Opt(idl.Text),
  });

  return idl.Service({
    clear_pack: idl.Func([], [HealthDto], []),
    health: idl.Func([], [HealthDto], ['query']),
    pack_info: idl.Func([], [PackInfo], ['query']),
    search: idl.Func([idl.Text, idl.Nat32], [idl.Vec(HitDto)], ['query']),
    set_pack: idl.Func([idl.Vec(idl.Nat8), idl.Text], [HealthDto], []),
  });
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getClientConfig(locationLike: Pick<Location, 'hostname'> = window.location) {
  const network = resolveNetwork(
    import.meta.env.VITE_DFX_NETWORK ?? __KNOLO_DFX_NETWORK__,
    locationLike.hostname
  );
  const host = resolveReplicaHost(locationLike.hostname, import.meta.env.VITE_IC_HOST);
  const canisterId = resolveCanisterId(
    import.meta.env.VITE_KNOLO_CANISTER_ID,
    __KNOLO_CANISTER_ID__
  );

  return { canisterId, host, network };
}

let actorPromise: Promise<ActorSubclass<KnoloService>> | undefined;

export async function getKnoloActor(): Promise<ActorSubclass<KnoloService>> {
  if (!actorPromise) {
    actorPromise = createKnoloActor().catch((error: unknown) => {
      actorPromise = undefined;
      throw error;
    });
  }

  return actorPromise;
}

async function createKnoloActor(): Promise<ActorSubclass<KnoloService>> {
  const config = getClientConfig();
  if (!config.canisterId) {
    throw new Error(
      'Missing canister ID. Set VITE_KNOLO_CANISTER_ID or run dfx deploy in examples/icp-knowledge-canister.'
    );
  }

  const agent = new HttpAgent({ host: config.host });
  if (config.network !== 'ic') {
    await agent.fetchRootKey().catch((error: unknown) => {
      throw new Error(
        `Unable to fetch the local replica root key from ${config.host}: ${formatError(error)}`
      );
    });
  }

  return Actor.createActor<KnoloService>(idlFactory, {
    agent,
    canisterId: config.canisterId,
  });
}
