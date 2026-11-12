import { homedir } from 'node:os';
import * as path from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;
const OFFER_ID = /^sha256-[0-9a-f]{64}$/;

export function knoloHome(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  return env.KNOLO_HOME && env.KNOLO_HOME.length > 0
    ? path.resolve(env.KNOLO_HOME)
    : path.join(home, '.knolo');
}

/** Same layout as the CLI cache. This module never writes knolo.lock.json. */
export function contentCachePath(home: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('Malformed V5 exchange sha256.');
  return path.join(home, 'cache', 'sha256', `${sha256}.knolo`);
}

export function receiptPath(home: string, receiptId: string): string {
  if (!OFFER_ID.test(receiptId))
    throw new Error('Malformed V5 exchange receipt id.');
  return path.join(home, 'exchange', 'receipts', `${receiptId}.cbor`);
}

export function partialPath(home: string, offerId: string): string {
  if (!OFFER_ID.test(offerId))
    throw new Error('Malformed V5 exchange offer id.');
  return path.join(home, 'exchange', 'partial', `${offerId}.part`);
}

export function endpointPath(store: string): string {
  return path.join(store, 'endpoint.json');
}
