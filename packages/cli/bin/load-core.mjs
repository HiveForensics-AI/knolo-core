import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const RETRIES = 2;

let hookRegistration;

function ensureHook() {
  hookRegistration ??= register(
    new URL('./core-load-hook.mjs', import.meta.url).href,
    import.meta.url
  );
  return hookRegistration;
}

function specifierFor(candidate) {
  if (
    candidate.startsWith('file:') ||
    candidate.startsWith('node:') ||
    candidate.startsWith('data:')
  ) {
    return candidate;
  }
  if (
    candidate.startsWith('/') ||
    candidate.startsWith('.') ||
    /^[A-Za-z]:[\\/]/.test(candidate)
  ) {
    return pathToFileURL(candidate).href;
  }
  return candidate;
}

function isNotFound(error) {
  return error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
}

async function withEpoch(specifier, epoch) {
  await ensureHook();
  const href = specifier.startsWith('file:') ? specifier : import.meta.resolve(specifier);
  const url = new URL(href);
  url.searchParams.set('knolo-epoch', String(epoch));
  return url.href;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function loadCoreModule(candidates, ready) {
  let lastError = null;
  for (const candidate of candidates) {
    const specifier = specifierFor(candidate);
    let missing = false;
    for (let epoch = 0; epoch <= RETRIES; epoch += 1) {
      try {
        const href = epoch === 0 ? specifier : await withEpoch(specifier, epoch);
        const loaded = await import(href);
        if (ready(loaded)) return loaded;
        lastError = new Error('module did not export the expected API');
      } catch (error) {
        lastError = error;
        if (isNotFound(error)) {
          missing = true;
          break;
        }
      }
      if (epoch < RETRIES) await delay(25 * (epoch + 1));
    }
    if (missing) continue;
    break;
  }
  throw lastError ?? new Error('module did not export the expected API');
}
