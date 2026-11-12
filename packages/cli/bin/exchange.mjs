import {
  adoptExchangeReceipt,
  exportExchangeDirectory,
  importExchangeDirectory,
  inspectExchangeReceipt,
  loadExchangeConfig,
  publishExchangeOffer,
  pullExchangeOffer,
  startExchangeServer,
} from '@knolo/exchange';
import { registryApiUrl, resolveRegistryUrl } from './registry/config.mjs';

export async function runExchangeCli(argv) {
  const { command, flags, positional } = parse(argv);
  if (!flags.config && command !== 'inspect' && command !== 'discover')
    throw new Error(
      'Usage: knolo exchange <serve|offer|pull|export|import|adopt|discover|inspect> --config <exchange.json>'
    );
  const config = flags.config ? loadExchangeConfig(flags.config) : undefined;
  const now = flags.now === undefined ? Date.now() : Number(flags.now);
  if (!Number.isSafeInteger(now))
    throw new Error('V5 exchange --now must be an integer.');
  if (command === 'serve') {
    const truncateAfter = readTruncateHook();
    const server = await startExchangeServer(config, {
      ...(flags.home ? { homeDir: flags.home } : {}),
      ...(flags.now === undefined ? {} : { now: () => now }),
      ...(truncateAfter === undefined ? {} : { truncateAfter }),
    });
    console.log(server.url);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    await server.close();
    return;
  }
  if (command === 'offer') {
    const imagePath = positional[0];
    if (!imagePath || !flags.to)
      throw new Error(
        'Usage: knolo exchange offer <image.knolo> --to <peer> --config <exchange.json>'
      );
    const published = await publishExchangeOffer(config, {
      imagePath,
      to: flags.to,
      now,
      ...(flags.ttl === undefined ? {} : { ttlMs: Number(flags.ttl) }),
    });
    console.log(published.offerId);
    return;
  }
  if (command === 'pull') {
    const offerId = positional[0];
    if (!offerId || !flags.from)
      throw new Error(
        'Usage: knolo exchange pull <offer-id> --from <peer> --config <exchange.json>'
      );
    const pulled = await pullExchangeOffer(config, {
      offerId,
      from: flags.from,
      now,
      ...(flags.home ? { homeDir: flags.home } : {}),
      ...(flags.ttl === undefined ? {} : { ttlMs: Number(flags.ttl) }),
    });
    console.log(`cache: ${pulled.cachePath}`);
    console.log(`sha256: ${pulled.sha256}`);
    console.log(`stateRoot: ${pulled.stateRoot}`);
    console.log(`receipt: ${pulled.receiptId}`);
    return;
  }
  if (command === 'export') {
    const imagePath = positional[0];
    if (!imagePath || !flags.to || !flags.out)
      throw new Error(
        'Usage: knolo exchange export <image.knolo> --to <peer> --out <dir> --config <exchange.json>'
      );
    const exported = await exportExchangeDirectory(config, {
      imagePath,
      to: flags.to,
      outDir: flags.out,
      now,
      ...(flags.ttl === undefined ? {} : { ttlMs: Number(flags.ttl) }),
    });
    console.log(`directory: ${exported.directory}`);
    console.log(`offer: ${exported.offerId}`);
    console.log(`sha256: ${exported.sha256}`);
    console.log(`stateRoot: ${exported.stateRoot}`);
    return;
  }
  if (command === 'import') {
    const directory = positional[0];
    if (!directory)
      throw new Error(
        'Usage: knolo exchange import <dir> --config <exchange.json>'
      );
    const imported = await importExchangeDirectory(config, {
      directory,
      now,
      ...(flags.home ? { homeDir: flags.home } : {}),
    });
    console.log(`cache: ${imported.cachePath}`);
    console.log(`sha256: ${imported.sha256}`);
    console.log(`stateRoot: ${imported.stateRoot}`);
    console.log(`receipt: ${imported.receiptId}`);
    return;
  }
  if (command === 'adopt') {
    const receiptId = positional[0];
    if (!receiptId || !flags.store || !flags.home)
      throw new Error(
        'Usage: knolo exchange adopt <receipt-id> --store <file> --home <dir> --config <exchange.json>'
      );
    const adopted = await adoptExchangeReceipt(config, {
      receiptId,
      storePath: flags.store,
      homeDir: flags.home,
      now,
    });
    console.log(`store: ${adopted.storePath}`);
    console.log(`relation: ${adopted.relation}`);
    console.log(`stateRoot: ${adopted.stateRoot}`);
    return;
  }
  if (command === 'discover') {
    const handle = positional[0];
    if (!handle || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(handle))
      throw new Error(
        'Usage: knolo exchange discover <handle> [--registry <url>]'
      );
    const registry = resolveRegistryUrl({ value: flags.registry });
    const response = await fetch(
      registryApiUrl(registry, ['publishers', handle])
    );
    if (!response.ok)
      throw new Error(
        `V5 exchange discover failed with status ${response.status}.`
      );
    const body = await response.json();
    const exchange = body?.publisher?.exchange;
    if (!Array.isArray(exchange) || exchange.length === 0)
      throw new Error('V5 exchange advertisement is missing.');
    for (const endpoint of exchange) {
      console.log(`url: ${endpoint.url}`);
      console.log(`keyId: ${endpoint.keyId}`);
      console.log(`keyringRoot: ${endpoint.keyringRoot}`);
    }
    return;
  }
  if (command === 'inspect') {
    const receiptId = positional[0];
    if (!receiptId || !flags.home)
      throw new Error(
        'Usage: knolo exchange inspect <receipt-id> --home <dir> [--config <exchange.json>]'
      );
    const receipt = await inspectExchangeReceipt(
      flags.home,
      receiptId,
      config,
      now
    );
    console.log(`role: ${receipt.role}`);
    console.log(`offer: ${receipt.offerId}`);
    console.log(`sha256: ${receipt.sha256}`);
    console.log(`stateRoot: ${receipt.stateRoot}`);
    console.log(`verification: ${receipt.verification}`);
    console.log(`policy: ${receipt.policy}`);
    return;
  }
  throw new Error(
    'Usage: knolo exchange <serve|offer|pull|export|import|adopt|discover|inspect>'
  );
}

function readTruncateHook() {
  const raw = process.env.KNOLO_EXCHANGE_TRUNCATE_AFTER;
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('V5 exchange truncate hook is invalid.');
  return value;
}

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === '--config' ||
      arg === '--to' ||
      arg === '--from' ||
      arg === '--home' ||
      arg === '--ttl' ||
      arg === '--now' ||
      arg === '--out' ||
      arg === '--store' ||
      arg === '--registry'
    ) {
      flags[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag for exchange: ${arg}`);
    } else positional.push(arg);
  }
  return { command: positional[0], positional: positional.slice(1), flags };
}
