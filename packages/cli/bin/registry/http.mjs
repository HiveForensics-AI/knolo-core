import { RegistryError, RegistryNetworkError, registryErrorMessage } from './errors.mjs';

export async function getJson(url, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json', ...headers },
    });
  } catch (error) {
    throw new RegistryNetworkError(`Could not reach registry at ${new URL(url).origin}.`, { url: String(url), cause: error });
  }

  const text = await readResponseText(response, url);
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new RegistryError(`Registry returned HTTP ${response.status} with a non-JSON response.`, {
          status: response.status,
          url: String(url),
          body: text.slice(0, 240),
        });
      }
      throw new RegistryError('Registry returned invalid JSON.', {
        status: response.status,
        code: 'invalid_response',
        url: String(url),
        body: text.slice(0, 240),
      });
    }
  }

  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : undefined;
    throw new RegistryError(registryErrorMessage({ status: response.status, code, body, url: String(url) }), {
      status: response.status,
      code,
      url: String(url),
      body,
    });
  }

  return body;
}

async function readResponseText(response, url) {
  try {
    return await response.text();
  } catch (error) {
    throw new RegistryNetworkError(`Could not read registry response from ${new URL(url).origin}.`, { url: String(url), cause: error });
  }
}
