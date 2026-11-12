import {
  inspectExchangeReceipt,
  loadExchangeConfig,
  publishExchangeOffer,
  pullExchangeOffer,
  startExchangeServer,
} from '@knolo/exchange';

export async function runExchangeCli(argv) {
  const { command, flags, positional } = parse(argv);
  if (!flags.config && command !== 'inspect')
    throw new Error(
      'Usage: knolo exchange <serve|offer|pull|inspect> --config <exchange.json>'
    );
  const config = flags.config ? loadExchangeConfig(flags.config) : undefined;
  const now = flags.now === undefined ? Date.now() : Number(flags.now);
  if (!Number.isSafeInteger(now))
    throw new Error('V5 exchange --now must be an integer.');
  if (command === 'serve') {
    const server = await startExchangeServer(config, {
      ...(flags.home ? { homeDir: flags.home } : {}),
      ...(flags.now === undefined ? {} : { now: () => now }),
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
  throw new Error('Usage: knolo exchange <serve|offer|pull|inspect>');
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
      arg === '--now'
    ) {
      flags[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown flag for exchange: ${arg}`);
    } else positional.push(arg);
  }
  return { command: positional[0], positional: positional.slice(1), flags };
}
