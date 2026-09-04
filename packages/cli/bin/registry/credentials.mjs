import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

const TOKEN_PATTERN = /^kno_[A-Za-z0-9_-]+$/;

export function credentialsPath({ env = process.env, homeDir = homedir() } = {}) {
  const configHome = env.XDG_CONFIG_HOME ? path.resolve(env.XDG_CONFIG_HOME) : path.join(homeDir, '.config');
  return path.join(configHome, 'knolo', 'credentials.json');
}

export async function saveCredentials({ registry, token, env = process.env, homeDir = homedir() } = {}) {
  const normalizedToken = typeof token === 'string' ? token.trim() : token;
  validateToken(normalizedToken);
  if (typeof registry !== 'string' || !registry) throw new Error('Credential registry is required.');
  const targetPath = credentialsPath({ env, homeDir });
  const directory = path.dirname(targetPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const value = {
    registry,
    token: normalizedToken,
    prefix: normalizedToken.slice(0, 12),
  };
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, targetPath);
    await chmod(targetPath, 0o600);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
  return { path: targetPath, registry, prefix: value.prefix };
}

export async function loadCredentials({ env = process.env, homeDir = homedir() } = {}) {
  const filePath = credentialsPath({ env, homeDir });
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Not logged in. Run "knolo login" first.');
    throw error;
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON in knolo credentials.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Knolo credentials must be a JSON object.');
  if (typeof value.registry !== 'string' || !value.registry) throw new Error('Knolo credentials are missing registry.');
  validateToken(value.token);
  if (typeof value.prefix !== 'string' || value.prefix !== value.token.slice(0, 12)) throw new Error('Knolo credentials have an invalid token prefix.');
  return { path: filePath, registry: value.registry, token: value.token, prefix: value.prefix };
}

export async function removeCredentials({ env = process.env, homeDir = homedir() } = {}) {
  const filePath = credentialsPath({ env, homeDir });
  try {
    await unlink(filePath);
    return { path: filePath, removed: true };
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: filePath, removed: false };
    throw error;
  }
}

export async function promptForToken({ input = process.stdin, output = process.stderr, forceStdin = false } = {}) {
  if (forceStdin || !input.isTTY) {
    const chunks = [];
    for await (const chunk of input) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }

  const readline = createInterface({ input, output });
  try {
    return (await readline.question('Hub token (kno_…): ')).trim();
  } finally {
    readline.close();
  }
}

export function validateToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token.trim())) {
    throw new Error('Token must start with kno_ and contain only base64url characters.');
  }
}
