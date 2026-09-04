import { RegistryError, RegistryNetworkError, registryErrorMessage } from './errors.mjs';

export async function getJson(url, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
  return requestJson(url, { fetchImpl, headers, method: 'GET' });
}

export async function postJson(url, body, { fetchImpl = globalThis.fetch, headers = {} } = {}) {
  return requestJson(url, { fetchImpl, headers, method: 'POST', body });
}

export async function putBytes(url, bytes, {
  fetchImpl = globalThis.fetch,
  headers = {},
  validateRedirect,
  maxRedirects = 5,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) throw new Error('maxRedirects must be a non-negative integer.');

  let destination = String(url);
  for (let redirectCount = 0; ; redirectCount++) {
    let response;
    try {
      response = await fetchImpl(destination, {
        method: 'PUT',
        redirect: 'manual',
        headers: { 'content-type': 'application/octet-stream', ...headers },
        body: bytes,
      });
    } catch (error) {
      throw new RegistryNetworkError(`Could not upload artifact to ${new URL(destination).origin}.`, { url: destination, cause: error });
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= maxRedirects) throw new Error(`Blob upload exceeded the ${maxRedirects}-redirect limit.`);
      const location = readHeader(response.headers, 'location');
      if (!location) throw new Error(`Blob upload redirect from ${destination} did not include a Location header.`);
      let redirectedUrl;
      try {
        redirectedUrl = new URL(location, destination);
      } catch {
        throw new Error(`Blob upload redirect from ${destination} has an invalid Location header.`);
      }
      if (typeof validateRedirect === 'function') validateRedirect(redirectedUrl, new URL(destination));
      destination = redirectedUrl.toString();
      continue;
    }

    if (!response.ok) {
      const detail = await readResponseText(response, destination);
      throw new RegistryError(`Blob upload failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`, {
        status: response.status,
        url: destination,
        body: detail,
      });
    }

    return { status: response.status, url: response.url || destination };
  }
}

async function requestJson(url, { fetchImpl = globalThis.fetch, headers = {}, method = 'GET', body: requestBody } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers: { accept: 'application/json', ...(requestBody !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(requestBody !== undefined ? { body: JSON.stringify(requestBody) } : {}),
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

function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) || undefined;
  return headers[name] || headers[name.toLowerCase()] || headers[name[0].toUpperCase() + name.slice(1)] || undefined;
}
