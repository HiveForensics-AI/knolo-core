import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const MAX_ARTIFACT_BYTES = 250 * 1024 * 1024;

export async function downloadBlobToTemp(url, {
  tempDir,
  expectedSize = 0,
  fetchImpl = globalThis.fetch,
} = {}) {
  const blobUrl = new URL(url);
  if (blobUrl.protocol !== 'https:') throw new Error('Blob URL must use HTTPS.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) throw new Error('Manifest sizeBytes is invalid.');
  if (expectedSize > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds Hub’s 250 MB limit.');

  let response;
  try {
    response = await fetchImpl(blobUrl, { method: 'GET', redirect: 'follow' });
  } catch (error) {
    throw new Error(`Could not download artifact from ${blobUrl.origin}.`, { cause: error });
  }

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`Artifact download failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:') throw new Error('Blob redirect must remain HTTPS.');
  }

  const contentLength = readContentLength(response);
  if (contentLength !== undefined && contentLength > MAX_ARTIFACT_BYTES) {
    throw new Error('Artifact exceeds Hub’s 250 MB limit.');
  }
  if (expectedSize > 0 && contentLength !== undefined && contentLength !== expectedSize) {
    throw new Error(`Artifact Content-Length ${contentLength} does not match manifest sizeBytes ${expectedSize}.`);
  }

  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `.download-${randomUUID()}.tmp`);
  const output = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
  const hash = createHash('sha256');
  let sizeBytes = 0;

  try {
    if (response.body && typeof response.body.getReader === 'function') {
      for await (const chunk of Readable.fromWeb(response.body)) {
        const bytes = Buffer.from(chunk);
        sizeBytes += bytes.length;
        if (sizeBytes > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds Hub’s 250 MB limit.');
        hash.update(bytes);
        await writeChunk(output, bytes);
      }
    } else if (typeof response.arrayBuffer === 'function') {
      const bytes = Buffer.from(await response.arrayBuffer());
      sizeBytes = bytes.length;
      if (sizeBytes > MAX_ARTIFACT_BYTES) throw new Error('Artifact exceeds Hub’s 250 MB limit.');
      hash.update(bytes);
      await writeChunk(output, bytes);
    } else {
      throw new Error('Artifact response did not provide a readable body.');
    }
    await endStream(output);
  } catch (error) {
    output.destroy();
    await unlink(tempPath).catch(() => {});
    throw error;
  }

  if (expectedSize > 0 && sizeBytes !== expectedSize) {
    await unlink(tempPath).catch(() => {});
    throw new Error(`Artifact body length ${sizeBytes} does not match manifest sizeBytes ${expectedSize}.`);
  }

  await chmod(tempPath, 0o600);
  return { tempPath, sizeBytes, sha256: hash.digest('hex'), contentLength };
}

export async function readArtifact(tempPath) {
  return new Uint8Array(await readFile(tempPath));
}

export async function installCachedArtifact(tempPath, cachePath) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await chmod(tempPath, 0o644);
  await rename(tempPath, cachePath);
  await chmod(cachePath, 0o644);
  return cachePath;
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      stream.off('drain', onDrain);
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function endStream(stream) {
  await new Promise((resolve, reject) => {
    const onClose = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      stream.off('close', onClose);
      reject(error);
    };
    stream.once('close', onClose);
    stream.once('error', onError);
    stream.end();
  });
}

function readContentLength(response) {
  const raw = response.headers?.get?.('content-length') ?? response.headers?.['content-length'] ?? response.headers?.['Content-Length'];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Artifact Content-Length is invalid.');
  return value;
}

async function safeResponseText(response) {
  try {
    const text = await response.text();
    return String(text || '').replace(/\s+/g, ' ').slice(0, 240);
  } catch {
    return '';
  }
}
