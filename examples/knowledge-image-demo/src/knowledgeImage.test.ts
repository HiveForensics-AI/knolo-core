import { readFileSync } from 'node:fs';

import {
  mountKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '@knolo/core';
import { describe, expect, it } from 'vitest';

import { queryAndResolve, verifyAndMount } from './knowledgeImage';

const fixtureBytes = new Uint8Array(
  readFileSync(new URL('../public/demo-image.v5', import.meta.url))
);

describe('demo Knowledge Image helpers', () => {
  it('verifies and mounts the demo fixture', () => {
    const { image, verification } = verifyAndMount(fixtureBytes);

    expect(verification.valid).toBe(true);
    expect(image.objects.length).toBeGreaterThan(1);
  });

  it('rejects truncated image bytes', () => {
    expect(() => verifyKnowledgeImageV5(fixtureBytes.slice(0, 8))).toThrow();
  });

  it('returns a chunk with its linked source metadata', () => {
    const image = mountKnowledgeImageV5(fixtureBytes);
    const results = queryAndResolve(image, 'arming');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceTitle).toBe('Flight Operations Handbook');
    expect(results[0].snippet).toContain('arming');
  });

  it('returns no hits for a term not present in the fixture', () => {
    const image = mountKnowledgeImageV5(fixtureBytes);

    expect(queryAndResolve(image, 'no-such-demo-term-9347')).toEqual([]);
  });
});
