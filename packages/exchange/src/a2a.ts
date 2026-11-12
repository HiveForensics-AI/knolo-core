const OFFER_ID = /^sha256-[0-9a-f]{64}$/;

export type ExchangeAgentCard = {
  url: string;
  capabilities: {
    'knolo.exchange/offer': { offerId: string };
  };
};

export function buildExchangeAgentCard(input: {
  url: string;
  offerId: string;
}): ExchangeAgentCard {
  return {
    url: requireHttps(input.url),
    capabilities: {
      'knolo.exchange/offer': { offerId: requireOfferId(input.offerId) },
    },
  };
}

export function readExchangeOfferRef(card: unknown): {
  url: string;
  offerId: string;
} {
  if (!card || typeof card !== 'object' || Array.isArray(card))
    throw new Error('V5 exchange agent card must be an object.');
  const record = card as {
    url?: unknown;
    capabilities?: unknown;
  };
  const capabilities = record.capabilities;
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    Array.isArray(capabilities)
  ) {
    throw new Error('V5 exchange agent card has no offer.');
  }
  const offer = (capabilities as { 'knolo.exchange/offer'?: unknown })[
    'knolo.exchange/offer'
  ];
  if (!offer || typeof offer !== 'object' || Array.isArray(offer))
    throw new Error('V5 exchange agent card has no offer.');
  return {
    url: requireHttps(record.url),
    offerId: requireOfferId((offer as { offerId?: unknown }).offerId),
  };
}

function requireHttps(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('V5 exchange agent card url must be https.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('V5 exchange agent card url must be https.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('V5 exchange agent card url must be https.');
  return value;
}

function requireOfferId(value: unknown): string {
  if (typeof value !== 'string' || !OFFER_ID.test(value))
    throw new Error('V5 exchange agent card offer id is malformed.');
  return value;
}
