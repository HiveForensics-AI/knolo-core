import {
  RegistryError,
  RegistryNetworkError,
  registryErrorMessage,
} from './errors.mjs';

export async function getJson(
  url,
  { fetchImpl = globalThis.fetch, headers = {} } = {}
) {
  return requestJson(url, { fetchImpl, headers, method: 'GET' });
}

export async function postJson(
  url,
  body,
  { fetchImpl = globalThis.fetch, headers = {} } = {}
) {
  return requestJson(url, { fetchImpl, headers, method: 'POST', body });
}

export async function putBytes(
  url,
  bytes,
  { fetchImpl = globalThis.fetch, headers = {} } = {}
) {
  if (typeof fetchImpl !== 'function')
    throw new Error('This Node runtime does not provide fetch.');

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'PUT',
      redirect: 'follow',
      headers: { 'content-type': 'application/octet-stream', ...headers },
      body: bytes,
    });
  } catch (error) {
    throw new RegistryNetworkError(
      `Could not upload artifact to ${new URL(url).origin}.`,
      { url: String(url), cause: error }
    );
  }

  const text = await readResponseText(response, url);
  let parsed;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const detail =
      (parsed && typeof parsed.error === 'object' && parsed.error?.message) ||
      (typeof parsed?.error === 'string' && parsed.error) ||
      (typeof parsed?.message === 'string' && parsed.message) ||
      (text ? text.slice(0, 240) : '');
    throw new RegistryError(
      `Blob upload failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
      {
        status: response.status,
        url: String(url),
        body: parsed ?? text,
      }
    );
  }

  const publicUrl =
    (parsed && typeof parsed.url === 'string' && parsed.url) ||
    response.url ||
    String(url);
  return {
    status: response.status,
    url: publicUrl,
    pathname: parsed && typeof parsed.pathname === 'string' ? parsed.pathname : undefined,
    body: parsed,
  };
}

async function requestJson(
  url,
  {
    fetchImpl = globalThis.fetch,
    headers = {},
    method = 'GET',
    body: requestBody,
  } = {}
) {
  if (typeof fetchImpl !== 'function')
    throw new Error('This Node runtime does not provide fetch.');

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers: {
        accept: 'application/json',
        ...(requestBody !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
      ...(requestBody !== undefined
        ? { body: JSON.stringify(requestBody) }
        : {}),
    });
  } catch (error) {
    throw new RegistryNetworkError(
      `Could not reach registry at ${new URL(url).origin}.`,
      { url: String(url), cause: error }
    );
  }

  const text = await readResponseText(response, url);
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new RegistryError(
          `Registry returned HTTP ${response.status} with a non-JSON response.`,
          {
            status: response.status,
            url: String(url),
            body: text.slice(0, 240),
          }
        );
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
    throw new RegistryError(
      registryErrorMessage({
        status: response.status,
        code,
        body,
        url: String(url),
      }),
      {
        status: response.status,
        code,
        url: String(url),
        body,
      }
    );
  }

  return body;
}

async function readResponseText(response, url) {
  try {
    return await response.text();
  } catch (error) {
    throw new RegistryNetworkError(
      `Could not read registry response from ${new URL(url).origin}.`,
      { url: String(url), cause: error }
    );
  }
}
