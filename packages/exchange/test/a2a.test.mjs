import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExchangeAgentCard, readExchangeOfferRef } from '../dist/index.js';

const OFFER_ID = `sha256-${'cd'.repeat(32)}`;

test('an agent card points at an offer and does not move bytes', () => {
  const card = buildExchangeAgentCard({
    url: 'https://agent.example/a2a',
    offerId: OFFER_ID,
  });
  assert.deepEqual(card, {
    url: 'https://agent.example/a2a',
    capabilities: { 'knolo.exchange/offer': { offerId: OFFER_ID } },
  });
  assert.deepEqual(readExchangeOfferRef(card), {
    url: 'https://agent.example/a2a',
    offerId: OFFER_ID,
  });
  assert.deepEqual(
    readExchangeOfferRef({
      name: 'agent-b',
      ...card,
    }),
    { url: 'https://agent.example/a2a', offerId: OFFER_ID }
  );
  assert.throws(
    () =>
      buildExchangeAgentCard({
        url: 'http://agent.example/a2a',
        offerId: OFFER_ID,
      }),
    /https/
  );
  assert.throws(
    () =>
      readExchangeOfferRef({ url: 'https://agent.example', capabilities: {} }),
    /offer/
  );
  assert.throws(
    () =>
      readExchangeOfferRef({
        url: 'https://agent.example',
        capabilities: { 'knolo.exchange/offer': { offerId: 'offer-1' } },
      }),
    /offer id/
  );
});
