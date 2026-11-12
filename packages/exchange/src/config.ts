import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export type ExchangeReceivePolicy = {
  senders: string[];
  kinds: ['knowledge-image'];
  maxBytes: number;
  namespaces: string[];
};

export type ExchangeConfig = {
  configPath: string;
  identity: {
    principal: string;
    keyId: string;
    privateKeyPath: string;
    keyringPath: string;
  };
  listen: { host: string; port: number };
  tls: { certPath: string; keyPath: string; caPath?: string };
  adminToken?: string;
  storePath: string;
  peers: Record<string, { principal: string; keyId: string; url: string }>;
  policy: { receive: ExchangeReceivePolicy; adopt: 'deny' | 'allow' };
};

const PRINCIPAL = /^[\x21-\x7e]{1,256}$/;

export function loadExchangeConfig(configPath: string): ExchangeConfig {
  const absolute = path.resolve(configPath);
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('V5 exchange config must be a JSON object.');
  }
  const record = raw as Record<string, unknown>;
  const base = path.dirname(absolute);
  const identity = asRecord(record.identity, 'identity');
  const tls = asRecord(record.tls, 'tls');
  const policy = asRecord(record.policy, 'policy');
  const receive = asRecord(policy.receive, 'policy.receive');
  const listen = parseListen(asString(record.listen, 'listen'));
  const adminToken =
    record.adminToken === undefined
      ? undefined
      : asString(record.adminToken, 'adminToken');
  if (listen.host !== '127.0.0.1' && listen.host !== '::1' && !adminToken) {
    throw new Error(
      'V5 exchange listen address requires adminToken when it is not loopback.'
    );
  }
  if (policy.adopt !== 'deny' && policy.adopt !== 'allow')
    throw new Error('V5 exchange adopt must be allow or deny.');
  const kinds = asStringArray(receive.kinds, 'policy.receive.kinds');
  if (kinds.length !== 1 || kinds[0] !== 'knowledge-image') {
    throw new Error(
      'V5 exchange policy kinds must be knowledge-image in this version.'
    );
  }
  const senders = asStringArray(receive.senders, 'policy.receive.senders');
  if (
    senders.length === 0 ||
    senders.some((sender) => !PRINCIPAL.test(sender))
  ) {
    throw new Error('V5 exchange policy senders are malformed.');
  }
  const namespaces = asStringArray(
    receive.namespaces,
    'policy.receive.namespaces'
  );
  const maxBytes = asPositive(receive.maxBytes, 'policy.receive.maxBytes');
  const peers = parsePeers(record.peers);
  return {
    configPath: absolute,
    identity: {
      principal: asPrincipal(identity.principal, 'identity.principal'),
      keyId: asString(identity.keyId, 'identity.keyId'),
      privateKeyPath: resolveExisting(
        base,
        asString(identity.privateKeyPath, 'identity.privateKeyPath')
      ),
      keyringPath: resolveExisting(
        base,
        asString(identity.keyringPath, 'identity.keyringPath')
      ),
    },
    listen,
    tls: {
      certPath: resolveExisting(base, asString(tls.cert, 'tls.cert')),
      keyPath: resolveExisting(base, asString(tls.key, 'tls.key')),
      ...(tls.ca === undefined
        ? {}
        : { caPath: resolveExisting(base, asString(tls.ca, 'tls.ca')) }),
    },
    ...(adminToken === undefined ? {} : { adminToken }),
    storePath: path.resolve(base, asString(record.store, 'store')),
    peers,
    policy: {
      receive: { senders, kinds: ['knowledge-image'], maxBytes, namespaces },
      adopt: policy.adopt,
    },
  };
}

export function peerByName(
  config: ExchangeConfig,
  name: string
): { principal: string; keyId: string; url: string } {
  const peer = config.peers[name];
  if (!peer) throw new Error(`V5 exchange peer was not configured: ${name}.`);
  return peer;
}

function parsePeers(value: unknown): ExchangeConfig['peers'] {
  const record = asRecord(value, 'peers');
  const peers: ExchangeConfig['peers'] = {};
  for (const [name, entry] of Object.entries(record)) {
    if (!PRINCIPAL.test(name))
      throw new Error('V5 exchange peer name is malformed.');
    const peer = asRecord(entry, `peers.${name}`);
    const principal = asPrincipal(peer.principal, `peers.${name}.principal`);
    if (principal !== name)
      throw new Error(`V5 exchange peer ${name} must use that principal.`);
    const url = asString(peer.url, `peers.${name}.url`);
    if (!url.startsWith('https://'))
      throw new Error(`V5 exchange peer ${name} url must be https.`);
    peers[name] = {
      principal,
      keyId: asString(peer.keyId, `peers.${name}.keyId`),
      url: url.replace(/\/$/, ''),
    };
  }
  return peers;
}

function parseListen(value: string): { host: string; port: number } {
  const match = /^(127\.0\.0\.1|::1|0\.0\.0\.0):(\d+)$/.exec(value);
  if (!match)
    throw new Error(
      'V5 exchange listen must be 127.0.0.1, ::1, or 0.0.0.0 with a port.'
    );
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('V5 exchange listen port is invalid.');
  return { host: match[1], port };
}

function resolveExisting(base: string, filePath: string): string {
  return path.resolve(base, filePath);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`V5 exchange ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new Error(`V5 exchange ${label} must be a string.`);
  return value;
}

function asPrincipal(value: unknown, label: string): string {
  const text = asString(value, label);
  if (!PRINCIPAL.test(text))
    throw new Error(`V5 exchange ${label} is malformed.`);
  return text;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`V5 exchange ${label} must be an array of strings.`);
  }
  return value as string[];
}

function asPositive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`V5 exchange ${label} must be a positive integer.`);
  }
  return value;
}
