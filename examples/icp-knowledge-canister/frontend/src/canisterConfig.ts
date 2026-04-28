export const LOCAL_REPLICA_HOST = 'http://127.0.0.1:4943';
export const IC_REPLICA_HOST = 'https://icp-api.io';

function trimValue(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isLocalPage(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export function resolveNetwork(networkOverride: string | undefined, hostname: string): string {
  return trimValue(networkOverride) ?? (isLocalPage(hostname) ? 'local' : 'ic');
}

export function resolveReplicaHost(hostname: string, hostOverride: string | undefined): string {
  return trimValue(hostOverride) ?? (isLocalPage(hostname) ? LOCAL_REPLICA_HOST : IC_REPLICA_HOST);
}

export function resolveCanisterId(
  explicitCanisterId: string | undefined,
  fallbackCanisterId: string | undefined
): string | undefined {
  return trimValue(explicitCanisterId) ?? trimValue(fallbackCanisterId);
}
