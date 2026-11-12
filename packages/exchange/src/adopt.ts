import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import {
  compareKnowledgeSyncImagesV5,
  decodeKnowledgeExchangeReceiptV1,
  describeKnowledgeExchangeArtifactV1,
} from '@knolo/core';
import { DurableKnowledgeImageStoreV5 } from '@knolo/core/node';
import type { ExchangeConfig } from './config.js';
import { contentCachePath, knoloHome, receiptPath } from './paths.js';

export type ExchangeAdoptResult = {
  storePath: string;
  relation: 'created' | 'equal' | 'remote-ahead';
  stateRoot: string;
};

export async function adoptExchangeReceipt(
  config: ExchangeConfig,
  input: {
    receiptId: string;
    storePath: string;
    homeDir?: string;
    now?: number;
  }
): Promise<ExchangeAdoptResult> {
  if (config.policy.adopt !== 'allow')
    throw new Error('V5 exchange adopt is deny.');
  const homeDir = input.homeDir ?? knoloHome();
  const storePath = path.resolve(input.storePath);
  const receipt = decodeKnowledgeExchangeReceiptV1(
    new Uint8Array(await readFile(receiptPath(homeDir, input.receiptId)))
  );
  if (receipt.role !== 'recipient')
    throw new Error('V5 exchange adopt requires a recipient receipt.');
  if (receipt.decision !== 'accept')
    throw new Error('V5 exchange adopt requires an accepted receipt.');
  if (receipt.verification !== 'verified')
    throw new Error('V5 exchange adopt requires a verified receipt.');
  const imageBytes = new Uint8Array(
    await readFile(contentCachePath(homeDir, receipt.sha256))
  );
  if (imageBytes.length !== receipt.sizeBytes)
    throw new Error('V5 exchange artifact size mismatch.');
  if (createHash('sha256').update(imageBytes).digest('hex') !== receipt.sha256)
    throw new Error('V5 exchange artifact digest mismatch.');
  const described = describeKnowledgeExchangeArtifactV1(imageBytes);
  if (described.stateRoot !== receipt.stateRoot)
    throw new Error('V5 exchange image state root mismatch.');
  if (!(await exists(storePath))) {
    const created = DurableKnowledgeImageStoreV5.open(storePath, imageBytes);
    try {
      return {
        storePath,
        relation: 'created',
        stateRoot: created.stateRoot,
      };
    } finally {
      created.close();
    }
  }
  const localBytes = new Uint8Array(await readFile(storePath));
  const plan = compareKnowledgeSyncImagesV5(localBytes, imageBytes);
  if (plan.relation === 'equal') {
    return { storePath, relation: 'equal', stateRoot: plan.local.stateRoot };
  }
  if (plan.relation !== 'remote-ahead')
    throw new Error(`V5 exchange adopt refused a ${plan.relation} store.`);
  const store = DurableKnowledgeImageStoreV5.open(storePath);
  try {
    const snapshot = store.fastForward(imageBytes);
    return {
      storePath,
      relation: 'remote-ahead',
      stateRoot: snapshot.stateRoot,
    };
  } finally {
    store.close();
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    )
      return false;
    throw error;
  }
}
