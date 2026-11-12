import test from 'node:test';
import { runExchangeConformance } from '../../../conformance/exchange/v1/run.mjs';

test('KIP-0028 exchange offer conformance', async () => {
  await runExchangeConformance();
});
