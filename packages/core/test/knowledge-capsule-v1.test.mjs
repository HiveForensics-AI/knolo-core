import test from 'node:test';
import { runCapsuleConformance } from '../../../conformance/capsule/v1/run.mjs';

test('KIP-0029 exchange capsule conformance', async () => {
  await runCapsuleConformance();
});
