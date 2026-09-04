import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LOCKFILE_NAME = 'knolo.lock.json';

export function lockfilePath(cwd = process.cwd()) {
  return path.resolve(cwd, LOCKFILE_NAME);
}

export function cachePath(homeDir, sha256) {
  return path.join(homeDir, '.knolo', 'cache', 'sha256', `${sha256}.knolo`);
}

export async function validateLockfileUpdate({ cwd = process.cwd(), registry, manifest, force = false } = {}) {
  const targetPath = lockfilePath(cwd);
  const current = await readLockfile(targetPath);
  if (current.registry && current.registry !== registry && !force) {
    throw new Error(`Lockfile registry is ${current.registry}; refusing to mix registries without --force.`);
  }

  const packs = current.packs && typeof current.packs === 'object' && !Array.isArray(current.packs)
    ? current.packs
    : {};
  const existing = packs[manifest.name];
  if (existing?.sha256 && existing.sha256 !== manifest.sha256 && !force) {
    throw new Error(`Lockfile already pins ${manifest.name} to a different digest; use --force to replace it.`);
  }

  const entry = {
    version: manifest.version,
    sha256: manifest.sha256,
    ...(manifest.stateRoot !== undefined ? { stateRoot: manifest.stateRoot } : {}),
    ...(manifest.license !== undefined ? { license: manifest.license } : {}),
  };
  return { targetPath, current, entry, packs };
}

export async function upsertLockfile({ cwd = process.cwd(), registry, manifest, force = false } = {}) {
  const { targetPath, entry, packs } = await validateLockfileUpdate({ cwd, registry, manifest, force });
  const next = {
    registry,
    packs: { ...packs, [manifest.name]: entry },
  };
  await atomicWriteJson(targetPath, next);
  return { path: targetPath, entry };
}

async function readLockfile(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { packs: {} };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${LOCKFILE_NAME}.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${LOCKFILE_NAME} must be a JSON object.`);
  if (value.registry !== undefined && typeof value.registry !== 'string') throw new Error(`${LOCKFILE_NAME}.registry must be a string.`);
  if (value.packs !== undefined && (typeof value.packs !== 'object' || Array.isArray(value.packs))) throw new Error(`${LOCKFILE_NAME}.packs must be an object.`);
  return value;
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
    await rename(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
